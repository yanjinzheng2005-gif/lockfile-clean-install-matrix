import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { UsageError } from './errors.js';
import { isInside } from './util.js';

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/;
const ALLOWED_KEYS = new Set([
  'schemaVersion',
  'projectPath',
  'manager',
  'baselineVersion',
  'candidateVersion',
  'nodeVersion',
  'timeoutSeconds',
  'registry',
  'outputDir',
]);

/** @typedef {'npm'|'pnpm'} Manager */

/**
 * @typedef {object} MatrixConfig
 * @property {1} schemaVersion
 * @property {string} configPath
 * @property {string} allowedRoot
 * @property {string} projectPath
 * @property {Manager} manager
 * @property {string} baselineVersion
 * @property {string} candidateVersion
 * @property {string} nodeVersion
 * @property {number} timeoutSeconds
 * @property {'https://registry.npmjs.org'} registry
 * @property {string} outputDir
 */

/**
 * @param {string} configPath
 * @param {{allowedRoot?: string}} [options]
 * @returns {Promise<MatrixConfig>}
 */
export async function loadConfig(configPath, options = {}) {
  const requestedRoot = path.resolve(options.allowedRoot ?? process.cwd());
  const allowedRoot = await realpath(requestedRoot).catch(() => {
    throw new UsageError('The trusted working directory does not exist.');
  });
  const requestedConfig = path.resolve(configPath);
  const absolute = await realpath(requestedConfig).catch(() => {
    throw new UsageError('The config file does not exist.');
  });
  if (!isInside(allowedRoot, absolute)) {
    throw new UsageError('The config file must stay inside the trusted working directory.');
  }
  let raw;
  try {
    raw = JSON.parse(await readFile(absolute, 'utf8'));
  } catch (error) {
    throw new UsageError(`Cannot read valid JSON config: ${error instanceof Error ? error.message : String(error)}`);
  }
  const config = validateConfig(raw, absolute, { allowedRoot });
  const canonicalProject = await realpath(config.projectPath).catch(() => {
    throw new UsageError('projectPath must name an existing directory.');
  });
  if (!isInside(allowedRoot, canonicalProject)) {
    throw new UsageError('projectPath resolves outside the trusted working directory.');
  }
  const projectInfo = await stat(canonicalProject);
  if (!projectInfo.isDirectory()) throw new UsageError('projectPath must name a directory.');
  const canonicalOutput = await canonicalFuturePath(config.outputDir);
  if (!isInside(allowedRoot, canonicalOutput)) {
    throw new UsageError('outputDir resolves outside the trusted working directory.');
  }
  if (canonicalOutput === canonicalProject) {
    throw new UsageError('outputDir cannot be the project root.');
  }
  if (isInside(canonicalOutput, canonicalProject)) {
    throw new UsageError('outputDir cannot contain the project root.');
  }
  try {
    const outputInfo = await stat(canonicalOutput);
    if (!outputInfo.isDirectory()) throw new UsageError('An existing outputDir must be a directory.');
  } catch (error) {
    if (error instanceof UsageError) throw error;
  }
  return { ...config, allowedRoot, projectPath: canonicalProject, outputDir: canonicalOutput };
}

/**
 * @param {unknown} raw
 * @param {string} [configPath]
 * @param {{allowedRoot?: string}} [options]
 * @returns {MatrixConfig}
 */
export function validateConfig(raw, configPath = path.resolve('lockfile-matrix.json'), options = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new UsageError('Config must be a JSON object.');
  }
  const value = /** @type {Record<string, unknown>} */ (raw);
  const unknown = Object.keys(value).filter((key) => !ALLOWED_KEYS.has(key));
  if (unknown.length) throw new UsageError(`Unknown config fields: ${unknown.join(', ')}`);
  if (value.schemaVersion !== 1) throw new UsageError('schemaVersion must be 1.');
  if (value.manager !== 'npm' && value.manager !== 'pnpm') {
    throw new UsageError('manager must be "npm" or "pnpm".');
  }
  for (const key of ['baselineVersion', 'candidateVersion', 'nodeVersion']) {
    const version = value[key];
    if (typeof version !== 'string' || !EXACT_VERSION.test(version)) {
      throw new UsageError(`${key} must be an exact semantic version such as 10.16.1.`);
    }
  }
  if (value.baselineVersion === value.candidateVersion) {
    throw new UsageError('baselineVersion and candidateVersion must differ.');
  }
  if (value.manager === 'pnpm') {
    for (const key of ['baselineVersion', 'candidateVersion']) {
      if (!isSafePnpmVersion(String(value[key]))) {
        throw new UsageError(`${key} selects a pnpm version below the V0.1 security floor (10.34.2 or 11.5.3 for their respective major lines).`);
      }
    }
  }
  const timeoutSeconds = value.timeoutSeconds === undefined ? 600 : value.timeoutSeconds;
  if (!Number.isInteger(timeoutSeconds) || Number(timeoutSeconds) < 30 || Number(timeoutSeconds) > 3600) {
    throw new UsageError('timeoutSeconds must be an integer from 30 to 3600.');
  }
  const registry = value.registry ?? 'https://registry.npmjs.org';
  if (registry !== 'https://registry.npmjs.org') {
    throw new UsageError('V0.1 only permits the public https://registry.npmjs.org registry.');
  }
  const base = path.dirname(configPath);
  const allowedRoot = path.resolve(options.allowedRoot ?? base);
  const projectValue = value.projectPath ?? '.';
  const outputValue = value.outputDir ?? 'lockfile-matrix-results';
  if (typeof projectValue !== 'string' || !projectValue.trim()) throw new UsageError('projectPath must be a non-empty string.');
  if (typeof outputValue !== 'string' || !outputValue.trim()) throw new UsageError('outputDir must be a non-empty string.');
  assertSafeRelativePath(projectValue, 'projectPath');
  assertSafeRelativePath(outputValue, 'outputDir');
  const resolvedProject = path.resolve(base, projectValue);
  const resolvedOutput = path.resolve(base, outputValue);
  if (!isInside(allowedRoot, resolvedProject)) throw new UsageError('projectPath must stay inside the trusted working directory.');
  if (!isInside(allowedRoot, resolvedOutput)) throw new UsageError('outputDir must stay inside the trusted working directory.');
  return {
    schemaVersion: 1,
    configPath: path.resolve(configPath),
    allowedRoot,
    projectPath: resolvedProject,
    manager: value.manager,
    baselineVersion: String(value.baselineVersion),
    candidateVersion: String(value.candidateVersion),
    nodeVersion: String(value.nodeVersion),
    timeoutSeconds: Number(timeoutSeconds),
    registry,
    outputDir: resolvedOutput,
  };
}

/** @param {unknown} value */
export function isExactVersion(value) {
  return typeof value === 'string' && EXACT_VERSION.test(value);
}

/** @param {string} value @param {string} field */
function assertSafeRelativePath(value, field) {
  if (path.isAbsolute(value)) throw new UsageError(`${field} must be a relative path.`);
  const parts = value.split(/[\\/]+/);
  if (parts.includes('..')) throw new UsageError(`${field} cannot contain ".." segments.`);
  if (/[\u0000-\u001F\u007F]/.test(value)) throw new UsageError(`${field} contains an invalid control character.`);
}

/** @param {string} value */
async function canonicalFuturePath(value) {
  let cursor = value;
  /** @type {string[]} */
  const missing = [];
  while (true) {
    try {
      const existing = await realpath(cursor);
      return path.join(existing, ...missing.reverse());
    } catch {
      const parent = path.dirname(cursor);
      if (parent === cursor) throw new UsageError('outputDir has no accessible parent directory.');
      missing.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

/** @param {string} value */
function isSafePnpmVersion(value) {
  const [core, prerelease] = value.split('-', 2);
  const [major, minor, patch] = core.split('.').map(Number);
  if (major < 10) return false;
  if (major === 10) return minor > 34 || (minor === 34 && (patch > 2 || (patch === 2 && !prerelease)));
  if (major === 11) return minor > 5 || (minor === 5 && (patch > 3 || (patch === 3 && !prerelease)));
  return major >= 12;
}
