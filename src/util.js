import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

/** @param {string|Buffer} value */
export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** @param {unknown} value */
export function stableJson(value) {
  return JSON.stringify(sortValue(value));
}

/** @param {unknown} value @returns {unknown} */
function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sortValue(item)]));
  }
  return value;
}

/** @param {string} root @param {string} candidate */
export function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/**
 * @param {string} value
 * @param {{projectRoot?:string,runRoot?:string,outputDir?:string,home?:string}} replacements
 */
export function redact(value, replacements = {}) {
  let output = stripUnsafeControlCharacters(value);
  const pairs = [
    [replacements.runRoot, '$RUN_ROOT'],
    [replacements.projectRoot, '$PROJECT_ROOT'],
    [replacements.outputDir, '$OUTPUT_DIR'],
    [replacements.home, '$HOME'],
  ].filter(([needle]) => Boolean(needle)).sort((a, b) => String(b[0]).length - String(a[0]).length);
  for (const [needle, replacement] of pairs) output = output.split(String(needle)).join(String(replacement));
  return output
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]')
    .replace(/\b(?:npm_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|(?:AKIA|ASIA)[A-Z0-9]{16})\b/g, '[REDACTED_TOKEN]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_JWT]')
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/((?:https?):\/\/[^\s#]+)#[^\s]+/gi, '$1#[REDACTED]')
    .replace(/([?&][^=\s&#]+)=([^&#\s]+)/g, '$1=[REDACTED]')
    .replace(/(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s"']+/gi, '$1[REDACTED]')
    .replace(/((?:_auth|authToken|api[_-]?key|credential|secret|signature|token|password)\s*[=:]\s*)[^\s"']+/gi, '$1[REDACTED]')
    .replace(/(^|\n)::/g, '$1[workflow-command-escaped]:');
}

/** @param {unknown} value @param {{projectRoot?:string,runRoot?:string,outputDir?:string,home?:string}} [replacements] @returns {unknown} */
export function redactValue(value, replacements = {}) {
  if (typeof value === 'string') return redact(value, replacements);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, replacements));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactValue(item, replacements)]));
  }
  return value;
}

/** @param {string} value */
export function stripUnsafeControlCharacters(value) {
  return value
    .replace(/\u001B\[[0-?]*[ -\/]*[@-~]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

/** @param {string} root @param {{exclude?:Set<string>,excludePaths?:Set<string>,maxFiles?:number,maxBytes?:number}} [options] */
export async function scanTree(root, options = {}) {
  const exclude = options.exclude ?? new Set();
  const excludePaths = new Set([...(options.excludePaths ?? new Set())].map((item) => path.resolve(item)));
  const maxFiles = options.maxFiles ?? 20000;
  const maxBytes = options.maxBytes ?? 250 * 1024 * 1024;
  /** @type {{absolute:string,relative:string,size:number}[]} */
  const files = [];
  /** @type {{relative:string,target:string|null}[]} */
  const symlinks = [];
  /** @type {string[]} */
  const excludedEntries = [];
  /** @type {string[]} */
  const specialEntries = [];
  let bytes = 0;
  /** @param {string} current */
  async function visit(current) {
    const absoluteCurrent = path.resolve(current);
    if ([...excludePaths].some((excluded) => isInside(excluded, absoluteCurrent))) return;
    const relative = path.relative(root, current) || '.';
    const name = path.basename(current);
    const entry = await lstat(current);
    if (entry.isSymbolicLink()) {
      let target = null;
      try { target = await realpath(current); } catch {}
      symlinks.push({ relative, target });
      return;
    }
    if (relative !== '.' && exclude.has(name)) {
      excludedEntries.push(relative);
      return;
    }
    if (entry.isDirectory()) {
      const children = await readdir(current);
      for (const child of children.sort()) await visit(path.join(current, child));
      return;
    }
    if (!entry.isFile()) {
      specialEntries.push(relative);
      return;
    }
    bytes += entry.size;
    files.push({ absolute: current, relative, size: entry.size });
    if (files.length > maxFiles) throw new Error(`Source exceeds ${maxFiles} files.`);
    if (bytes > maxBytes) throw new Error(`Source exceeds ${maxBytes} bytes.`);
  }
  await visit(root);
  return { files, symlinks, excludedEntries, specialEntries, bytes };
}

/** @param {string} root @param {Array<{relative:string,size:number,absolute:string}>} files */
export async function fingerprintFiles(root, files) {
  const rows = [];
  for (const file of [...files].sort((a, b) => a.relative.localeCompare(b.relative))) {
    rows.push(`${file.relative}\0${file.size}\0${await fileSha(file.absolute)}`);
  }
  return sha256(rows.join('\n'));
}

/** @param {string} file */
export async function fileSha(file) {
  return sha256(await readFile(file));
}

/** @param {string} root @param {string[]} relativeFiles */
export async function snapshotFiles(root, relativeFiles) {
  /** @type {Record<string,string>} */
  const result = {};
  for (const relative of [...new Set(relativeFiles)].sort()) {
    const absolute = path.join(root, relative);
    try {
      result[relative] = await fileSha(absolute);
    } catch {
      result[relative] = 'MISSING';
    }
  }
  return result;
}

/** @param {Record<string,string>} before @param {Record<string,string>} after */
export function diffSnapshots(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().filter((key) => before[key] !== after[key]).map((key) => ({ path: key, before: before[key] ?? 'MISSING', after: after[key] ?? 'MISSING' }));
}

/** @param {string} value */
export async function canonicalPath(value) {
  return realpath(value);
}

/** @param {string} value */
export async function ensureDirectory(value) {
  const info = await stat(value);
  if (!info.isDirectory()) throw new Error(`${value} is not a directory.`);
}
