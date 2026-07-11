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

function extractImportDeclarations(source) {
  const declarations = [];
  const patterns = [
    /\bimport\s+([\s\S]*?)\s+from\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];

  let match;
  while ((match = patterns[0].exec(source)) !== null) {
    declarations.push({
      specifier: match[2],
      names: importedNamesFromClause(match[1]),
    });
  }
  while ((match = patterns[1].exec(source)) !== null) {
    declarations.push({ specifier: match[1], names: [] });
  }
  while ((match = patterns[2].exec(source)) !== null) {
    declarations.push({ specifier: match[1], names: [] });
  }

  return declarations;
}

function importedNamesFromClause(clause) {
  const names = [];
  const trimmed = clause.trim();
  if (trimmed.startsWith('{')) {
    names.push(...namesFromImportList(trimmed));
    return names;
  }
  if (trimmed.startsWith('*')) {
    return names;
  }
  const commaIndex = trimmed.indexOf(',');
  if (commaIndex === -1) {
    names.push('default');
    return names;
  }
  names.push('default');
  names.push(...namesFromImportList(trimmed.slice(commaIndex + 1)));
  return names;
}

function namesFromImportList(text) {
  const open = text.indexOf('{');
  const close = text.lastIndexOf('}');
  if (open === -1 || close === -1 || close <= open) {
    return [];
  }
  return text.slice(open + 1, close)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.split(/\s+as\s+/i)[0].trim())
    .filter(Boolean);
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
  const exportCache = new Map();
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
    for (const declaration of extractImportDeclarations(source)) {
      const targetPath = resolveImport(currentPath, declaration.specifier);
      if (targetPath === null) {
        continue;
      }
      if (!existsSync(targetPath) || !statSync(targetPath).isFile()) {
        addFailure(
          failures,
          `${toRelativePath(currentPath)} imports ${declaration.specifier} missing at ${toRelativePath(targetPath)}`,
        );
        continue;
      }
      if (declaration.names.length > 0) {
        const exported = collectModuleExports(targetPath, exportCache, failures);
        for (const name of declaration.names) {
          if (!exported.has(name)) {
            addFailure(
              failures,
              `${toRelativePath(currentPath)} imports missing export ${name} from ${toRelativePath(targetPath)}`,
            );
          }
        }
      }
      stack.push(targetPath);
    }
  }

  return failures;
}

function collectModuleExports(filePath, cache, failures) {
  const key = path.normalize(filePath);
  if (cache.has(key)) {
    return cache.get(key);
  }
  const names = new Set();
  cache.set(key, names);
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    addFailure(failures, `module missing at ${toRelativePath(filePath)}`);
    return names;
  }

  const source = readText(filePath);
  for (const match of source.matchAll(/\bexport\s+default\b/g)) {
    if (match) {
      names.add('default');
    }
  }
  for (const match of source.matchAll(/\bexport\s+(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(match[1]);
  }
  for (const match of source.matchAll(/\bexport\s+(?:const|let|var)\s+([^;]+)/g)) {
    for (const declarator of match[1].split(',')) {
      const name = declarator.trim().match(/^([A-Za-z_$][\w$]*)/);
      if (name) {
        names.add(name[1]);
      }
    }
  }
  for (const match of source.matchAll(/\bexport\s*\{([\s\S]*?)\}(?:\s*from\s*["']([^"']+)["'])?/g)) {
    const entries = exportListEntries(match[1]);
    const specifier = match[2];
    if (specifier) {
      const targetPath = resolveImport(filePath, specifier);
      const targetExports = targetPath === null ? null : collectModuleExports(targetPath, cache, failures);
      for (const entry of entries) {
        if (targetExports !== null && !targetExports.has(entry.imported)) {
          addFailure(
            failures,
            `${toRelativePath(filePath)} re-exports missing export ${entry.imported} from ${specifier}`,
          );
        }
        names.add(entry.exported);
      }
    } else {
      for (const entry of entries) {
        names.add(entry.exported);
      }
    }
  }
  for (const match of source.matchAll(/\bexport\s+\*\s+from\s*["']([^"']+)["']/g)) {
    const targetPath = resolveImport(filePath, match[1]);
    if (targetPath === null) {
      continue;
    }
    const targetExports = collectModuleExports(targetPath, cache, failures);
    for (const name of targetExports) {
      if (name !== 'default') {
        names.add(name);
      }
    }
  }
  return names;
}

function exportListEntries(listText) {
  return listText
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const pieces = part.split(/\s+as\s+/i).map((piece) => piece.trim());
      return {
        imported: pieces[0],
        exported: pieces[1] ?? pieces[0],
      };
    });
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
