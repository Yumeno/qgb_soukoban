import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const indexPath = path.join(rootDir, 'index.html');
const entryPath = path.join(rootDir, 'src', 'ui', 'app.js');
const coreDir = path.join(rootDir, 'src', 'core');

const checks = [
  {
    name: 'asset references',
    run: checkAssetReferences,
  },
  {
    name: 'import graph',
    run: checkImportGraph,
  },
  {
    name: 'layer separation',
    run: checkLayerSeparation,
  },
];

function toAscii(value) {
  return String(value).replace(/[^\x00-\x7F]/g, '?');
}

function toRelativePath(filePath) {
  return toAscii(path.relative(rootDir, filePath).split(path.sep).join('/'));
}

function readText(filePath) {
  return readFileSync(filePath, 'utf8');
}

function withoutQueryOrHash(reference) {
  const query = reference.indexOf('?');
  const hash = reference.indexOf('#');
  const cuts = [query, hash].filter((index) => index >= 0);
  return cuts.length === 0 ? reference : reference.slice(0, Math.min(...cuts));
}

function isRelativeLocalReference(reference) {
  if (!reference || reference.startsWith('#') || reference.startsWith('/') || reference.startsWith('//')) {
    return false;
  }
  return !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(reference);
}

function resolveLocalReference(fromDir, reference) {
  const cleanReference = withoutQueryOrHash(reference);
  return path.resolve(fromDir, cleanReference);
}

function addFailure(failures, message) {
  failures.push(toAscii(message));
}

function formatFailures(failures) {
  return failures.length === 0 ? '' : `: ${failures.join('; ')}`;
}

function extractHtmlReferences(html) {
  const references = [];
  const patterns = [
    { tag: 'script', attr: 'src', regex: /<script\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi },
    { tag: 'link', attr: 'href', regex: /<link\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi },
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.regex.exec(html)) !== null) {
      references.push({
        tag: pattern.tag,
        attr: pattern.attr,
        value: match[1] ?? match[2] ?? match[3] ?? '',
      });
    }
  }

  return references;
}

function checkAssetReferences() {
  const failures = [];

  if (!existsSync(indexPath)) {
    addFailure(failures, 'missing index.html');
    return failures;
  }

  const html = readText(indexPath);
  const references = extractHtmlReferences(html);

  for (const reference of references) {
    if (!isRelativeLocalReference(reference.value)) {
      continue;
    }
    const targetPath = resolveLocalReference(path.dirname(indexPath), reference.value);
    if (!existsSync(targetPath) || !statSync(targetPath).isFile()) {
      addFailure(
        failures,
        `${reference.tag} ${reference.attr} ${reference.value} missing at ${toRelativePath(targetPath)}`,
      );
    }
  }

  return failures;
}

function extractImportSpecifiers(source) {
  const specifiers = new Set();
  const patterns = [
    /\bimport\s+[\s\S]*?\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bexport\s+[\s\S]*?\bfrom\s*["']([^"']+)["']/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      specifiers.add(match[1]);
    }
  }

  return [...specifiers];
}

function resolveImport(fromFile, specifier) {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    return null;
  }
  return path.resolve(path.dirname(fromFile), specifier);
}

function checkImportGraph() {
  const failures = [];
  const visited = new Set();
  const stack = [entryPath];

  if (!existsSync(entryPath)) {
    addFailure(failures, `entry missing at ${toRelativePath(entryPath)}`);
    return failures;
  }

  while (stack.length > 0) {
    const currentPath = stack.pop();
    const key = path.normalize(currentPath);
    if (visited.has(key)) {
      continue;
    }
    visited.add(key);

    if (!existsSync(currentPath) || !statSync(currentPath).isFile()) {
      addFailure(failures, `module missing at ${toRelativePath(currentPath)}`);
      continue;
    }

    const source = readText(currentPath);
    for (const specifier of extractImportSpecifiers(source)) {
      const targetPath = resolveImport(currentPath, specifier);
      if (targetPath === null) {
        continue;
      }
      if (!existsSync(targetPath) || !statSync(targetPath).isFile()) {
        addFailure(
          failures,
          `${toRelativePath(currentPath)} imports ${specifier} missing at ${toRelativePath(targetPath)}`,
        );
        continue;
      }
      stack.push(targetPath);
    }
  }

  return failures;
}

function collectJsFiles(dirPath, files) {
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      collectJsFiles(entryPath, files);
      continue;
    }
    if (entry.isFile() && path.extname(entry.name) === '.js') {
      files.push(entryPath);
    }
  }
}

function stripCommentsAndStrings(source) {
  let output = '';
  let index = 0;
  let state = 'code';
  let quote = '';

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (state === 'code') {
      if (char === '/' && next === '/') {
        state = 'line-comment';
        output += '  ';
        index += 2;
        continue;
      }
      if (char === '/' && next === '*') {
        state = 'block-comment';
        output += '  ';
        index += 2;
        continue;
      }
      if (char === '"' || char === "'" || char === '`') {
        state = 'string';
        quote = char;
        output += ' ';
        index += 1;
        continue;
      }
      output += char;
      index += 1;
      continue;
    }

    if (state === 'line-comment') {
      if (char === '\n' || char === '\r') {
        state = 'code';
        output += char;
      } else {
        output += ' ';
      }
      index += 1;
      continue;
    }

    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        state = 'code';
        output += '  ';
        index += 2;
      } else {
        output += char === '\n' || char === '\r' ? char : ' ';
        index += 1;
      }
      continue;
    }

    if (state === 'string') {
      if (char === '\\') {
        output += ' ';
        if (index + 1 < source.length) {
          output += source[index + 1] === '\n' || source[index + 1] === '\r' ? source[index + 1] : ' ';
        }
        index += 2;
        continue;
      }
      if (char === quote) {
        state = 'code';
        output += ' ';
        index += 1;
        continue;
      }
      output += char === '\n' || char === '\r' ? char : ' ';
      index += 1;
      continue;
    }
  }

  return output;
}

function checkLayerSeparation() {
  const failures = [];
  const files = [];

  if (!existsSync(coreDir) || !statSync(coreDir).isDirectory()) {
    addFailure(failures, 'missing src/core directory');
    return failures;
  }

  collectJsFiles(coreDir, files);
  files.sort((left, right) => toRelativePath(left).localeCompare(toRelativePath(right)));

  for (const filePath of files) {
    const source = readText(filePath);
    const specifiers = extractImportSpecifiers(source);

    for (const specifier of specifiers) {
      const targetPath = resolveImport(filePath, specifier);
      if (targetPath !== null) {
        const relativeTarget = path.relative(rootDir, targetPath).split(path.sep).join('/');
        if (relativeTarget.startsWith('src/ui/')) {
          addFailure(failures, `${toRelativePath(filePath)} imports ui module ${specifier}`);
        }
      } else if (specifier.startsWith('src/ui/')) {
        addFailure(failures, `${toRelativePath(filePath)} imports ui module ${specifier}`);
      }
    }

    const stripped = stripCommentsAndStrings(source);
    const forbidden = stripped.match(/\b(document|window|localStorage|fetch)\b/g) ?? [];
    for (const name of [...new Set(forbidden)]) {
      addFailure(failures, `${toRelativePath(filePath)} references ${name}`);
    }
  }

  return failures;
}

let failedChecks = 0;

for (const check of checks) {
  const failures = check.run();
  if (failures.length === 0) {
    console.log(`OK ${check.name}`);
  } else {
    failedChecks += 1;
    console.log(`FAIL ${check.name}${formatFailures(failures)}`);
  }
}

console.log(`summary: ${checks.length - failedChecks} ok, ${failedChecks} fail`);
process.exit(failedChecks === 0 ? 0 : 1);
