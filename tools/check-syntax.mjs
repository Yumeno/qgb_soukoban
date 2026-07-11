import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targetDirs = ['src', 'tools'];
const targetExtensions = new Set(['.js', '.mjs']);

function toAscii(value) {
  return value.replace(/[^\x00-\x7F]/g, '?');
}

function toRelativePath(filePath) {
  return toAscii(path.relative(rootDir, filePath).split(path.sep).join('/'));
}

function collectFiles(dirPath, files) {
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const entryPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      collectFiles(entryPath, files);
      continue;
    }

    if (entry.isFile() && targetExtensions.has(path.extname(entry.name))) {
      files.push(entryPath);
    }
  }
}

function firstErrorLine(result) {
  const output = `${result.stderr ?? ''}${result.stdout ?? ''}`;
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return toAscii(lines.find((line) => line.includes('SyntaxError')) ?? lines[0] ?? 'unknown error');
}

const files = [];

for (const dirName of targetDirs) {
  const dirPath = path.join(rootDir, dirName);
  if (existsSync(dirPath) && statSync(dirPath).isDirectory()) {
    collectFiles(dirPath, files);
  }
}

files.sort((left, right) => toRelativePath(left).localeCompare(toRelativePath(right)));

let failures = 0;

for (const filePath of files) {
  const relativePath = toRelativePath(filePath);
  const result = spawnSync(process.execPath, ['--check', filePath], {
    cwd: rootDir,
    encoding: 'utf8',
  });

  if (result.status === 0) {
    console.log(`OK ${relativePath}`);
    continue;
  }

  failures += 1;
  console.log(`FAIL ${relativePath}: ${firstErrorLine(result)}`);
}

console.log(`checked ${files.length} files, ${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
