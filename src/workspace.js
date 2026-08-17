import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isInside } from './util.js';
import { EXCLUDED_DIRECTORY_NAMES, isCopyOmittedFileName } from './policy.js';

const RUN_PREFIX = 'lockfile-clean-install-matrix-';
const SENTINEL = '.lockfile-matrix-run';
/** @type {Map<string,string>} */
const ownedRunRoots = new Map();

/** @param {string} source @param {string} destination @param {{excludePaths?:Set<string>}} [options] */
export async function copyProject(source, destination, options = {}) {
  if (isInside(source, destination)) throw new Error('The isolated copy cannot be created inside the source project.');
  await rm(destination, { recursive: true, force: true });
  await cp(source, destination, {
    recursive: true,
    dereference: false,
    preserveTimestamps: true,
    filter: (candidate) => {
      if (candidate === source) return true;
      const relative = path.relative(source, candidate);
      if ([...(options.excludePaths ?? new Set())].some((excluded) => isInside(path.resolve(excluded), path.resolve(candidate)))) return false;
      const parts = relative.split(path.sep);
      if (parts.some((part) => EXCLUDED_DIRECTORY_NAMES.has(part))) return false;
      const name = path.basename(candidate);
      if (isCopyOmittedFileName(name)) return false;
      return true;
    },
  });
}

export async function createRunRoot() {
  const created = await mkdtemp(path.join(tmpdir(), RUN_PREFIX));
  const root = await realpath(created);
  const token = randomBytes(24).toString('hex');
  await writeFile(path.join(root, SENTINEL), token, { mode: 0o600 });
  ownedRunRoots.set(root, token);
  return root;
}

/** @param {string} runRoot */
export async function cleanupRunRoot(runRoot) {
  const token = ownedRunRoots.get(runRoot);
  if (!token) throw new Error('Refusing to remove a directory not created by this process.');
  const canonicalParent = await realpath(path.dirname(runRoot));
  const canonicalTmp = await realpath(tmpdir());
  if (canonicalParent !== canonicalTmp || !path.basename(runRoot).startsWith(RUN_PREFIX)) {
    throw new Error('Refusing to remove a run directory outside the system temporary directory.');
  }
  const observed = await readFile(path.join(runRoot, SENTINEL), 'utf8').catch(() => '');
  if (observed !== token) throw new Error('Refusing to remove a run directory without the matching sentinel.');
  await rm(runRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  ownedRunRoots.delete(runRoot);
}

/** @param {string} directory */
export async function listDirectoryNames(directory) {
  try {
    return (await readdir(directory)).sort();
  } catch {
    return [];
  }
}
