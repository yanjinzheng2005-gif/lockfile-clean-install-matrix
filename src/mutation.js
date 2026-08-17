import path from 'node:path';
import { scanTree, snapshotFiles } from './util.js';

const PROTECTED_NAMES = new Set([
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  '.npmrc',
  '.pnpmfile.cjs',
  '.pnpmfile.mjs',
  '.pnpmfile.js',
]);

/** @param {string} root */
export async function snapshotProtectedFiles(root) {
  const scan = await scanTree(root, {
    exclude: new Set(['.git', 'node_modules', '.pnpm-store', '.yarn', 'lockfile-matrix-results']),
    maxFiles: 20000,
    maxBytes: 250 * 1024 * 1024,
  });
  const relativeFiles = scan.files
    .map((file) => file.relative)
    .filter((relative) => PROTECTED_NAMES.has(path.basename(relative)))
    .sort();
  return snapshotFiles(root, relativeFiles);
}

/**
 * @param {Record<string,string>} before
 * @param {Record<string,string>} after
 */
export function protectedFileDiff(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .sort()
    .filter((relative) => before[relative] !== after[relative])
    .map((relative) => ({
      path: relative,
      before: before[relative] ?? 'MISSING',
      after: after[relative] ?? 'MISSING',
    }));
}
