import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseAllDocuments } from 'yaml';
import { BoundaryError } from './errors.js';
import { canonicalPath, ensureDirectory, fingerprintFiles, isInside, scanTree } from './util.js';
import { EXCLUDED_DIRECTORY_NAMES, isCopyOmittedFileName, isSensitiveFileName, SENSITIVE_DIRECTORY_NAMES } from './policy.js';

const SECRET_NPMRC = /(?:_auth|authToken|password|username|certfile|keyfile)\s*=/i;
const REMOTE_SPEC = /^(?:https?:|git(?:\+[^:]+)?:|git@|github:|gitlab:|bitbucket:|ssh:)/i;
const DEPENDENCY_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'overrides', 'resolutions'];
const EXECUTABLE_PNPM_HOOK = /(?:^|\/)(?:\.pnpmfile|pnpmfile)\.(?:cjs|mjs|js)$/i;
const PNPM_EXECUTION_KEYS = new Set([
  'configdependencies',
  'packagemanagerdependencies',
  'configdependencyinstallengineallowlist',
  'pnpmfile',
  'globalpnpmfile',
  'managepackagemanagerversions',
  'usenodeversion',
  'executionenv',
]);
const PNPM_REGISTRY_KEYS = new Set([
  'registry',
  'registries',
  'namedregistries',
  'npmrcauthfile',
  'httpproxy',
  'httpsproxy',
  'proxy',
  'cafile',
  'certfile',
  'keyfile',
]);

/**
 * @typedef {object} PreflightResult
 * @property {string} canonicalProjectPath
 * @property {string} lockfile
 * @property {boolean} workspaceProject
 * @property {string[]} packageRoots
 * @property {string[]} protectedFiles
 * @property {number} sourceFileCount
 * @property {number} sourceBytes
 * @property {string[]} omittedSensitiveFiles
 * @property {string[]} warnings
 * @property {string} sourceFingerprint
 */

/** @param {import('./config.js').MatrixConfig} config @returns {Promise<PreflightResult>} */
export async function preflight(config) {
  await ensureDirectory(config.projectPath);
  const root = await canonicalPath(config.projectPath);
  if (!isInside(config.allowedRoot, root)) throw new BoundaryError('Project resolves outside the trusted working directory.');
  const scan = await scanTree(root, {
    exclude: EXCLUDED_DIRECTORY_NAMES,
    excludePaths: new Set([config.outputDir]),
  });
  /** @type {string[]} */
  const problems = [];
  /** @type {string[]} */
  const warnings = [];
  let workspaceProject = false;
  const relativeSet = new Set(scan.files.map((file) => file.relative));
  workspaceProject = config.manager === 'pnpm' && relativeSet.has('pnpm-workspace.yaml');
  if (!relativeSet.has('package.json')) problems.push('Root package.json is required.');

  let lockfile = 'pnpm-lock.yaml';
  if (config.manager === 'npm') {
    const hasPackageLock = relativeSet.has('package-lock.json');
    const hasShrinkwrap = relativeSet.has('npm-shrinkwrap.json');
    if (hasPackageLock && hasShrinkwrap) problems.push('V0.1 refuses projects containing both package-lock.json and npm-shrinkwrap.json because npm gives shrinkwrap priority.');
    if (!hasPackageLock && !hasShrinkwrap) problems.push('package-lock.json or npm-shrinkwrap.json is required for manager npm.');
    lockfile = hasShrinkwrap ? 'npm-shrinkwrap.json' : 'package-lock.json';
  } else if (!relativeSet.has(lockfile)) {
    problems.push('pnpm-lock.yaml is required for manager pnpm.');
  }

  if (scan.symlinks.length) problems.push(`V0.1 refuses source symlinks: ${scan.symlinks.slice(0, 10).map((item) => item.relative).join(', ')}`);
  if (scan.specialEntries.length) problems.push(`V0.1 refuses sockets, devices, and other special source entries: ${scan.specialEntries.slice(0, 10).join(', ')}`);
  const hookFiles = scan.files.map((file) => file.relative).filter((relative) => EXECUTABLE_PNPM_HOOK.test(relative));
  if (hookFiles.length) problems.push(`V0.1 refuses executable pnpm hooks: ${hookFiles.slice(0, 10).join(', ')}`);

  const packageFiles = scan.files.filter((file) => path.basename(file.relative) === 'package.json');
  for (const file of packageFiles) {
    let manifest;
    try {
      manifest = JSON.parse(await readFile(file.absolute, 'utf8'));
    } catch {
      problems.push(`Invalid JSON: ${file.relative}`);
      continue;
    }
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      problems.push(`Package manifest must be an object: ${file.relative}`);
      continue;
    }
    const record = /** @type {Record<string,unknown>} */ (manifest);
    const packageManager = record.packageManager;
    if (file.relative === 'package.json') {
      workspaceProject = workspaceProject || Array.isArray(record.workspaces)
        || Boolean(record.workspaces && typeof record.workspaces === 'object' && !Array.isArray(record.workspaces));
    }
    if (file.relative === 'package.json' && typeof packageManager === 'string' && !packageManager.startsWith(`${config.manager}@`)) {
      problems.push(`packageManager declares ${packageManager}, but config selects ${config.manager}.`);
    }
    inspectDependencySpecs(record, path.dirname(file.absolute), root, file.relative, problems);
  }

  const npmrcFiles = scan.files.filter((file) => path.basename(file.relative) === '.npmrc');
  if (npmrcFiles.length) {
    for (const npmrc of npmrcFiles) {
      const contents = await readFile(npmrc.absolute, 'utf8');
      if (SECRET_NPMRC.test(contents)) problems.push(`${npmrc.relative} contains credential-shaped settings.`);
    }
    problems.push('V0.1 refuses repository .npmrc files instead of silently changing their install semantics.');
  }

  if (config.manager === 'pnpm') {
    const workspaceFile = scan.files.find((file) => file.relative === 'pnpm-workspace.yaml');
    if (workspaceFile) await inspectPnpmYaml(workspaceFile.absolute, 'pnpm-workspace.yaml', root, problems, true);
  }

  const lockEntry = scan.files.find((file) => file.relative === lockfile);
  if (lockEntry) await inspectLockfile(lockEntry.absolute, config.manager, root, problems);

  const omittedSensitiveFiles = scan.files.map((file) => file.relative).filter((relative) => {
    const name = path.basename(relative);
    return isSensitiveFileName(name);
  });
  if (omittedSensitiveFiles.length) warnings.push(`Sensitive files will not be copied: ${omittedSensitiveFiles.join(', ')}`);
  const omittedSensitiveDirectories = scan.excludedEntries.filter((relative) => SENSITIVE_DIRECTORY_NAMES.has(path.basename(relative)));
  if (omittedSensitiveDirectories.length) warnings.push(`Sensitive directories will not be copied: ${omittedSensitiveDirectories.join(', ')}`);

  if (problems.length) throw new BoundaryError('Project failed the V0.1 safety boundary.', [...new Set(problems)]);
  const protectedFiles = scan.files.map((file) => file.relative).filter((relative) => {
    const name = path.basename(relative);
    return name === 'package.json' || name === 'package-lock.json' || name === 'npm-shrinkwrap.json' || name === 'pnpm-lock.yaml' || name === 'pnpm-workspace.yaml';
  }).sort();
  const copiedFiles = scan.files.filter((entry) => !isCopyOmittedFileName(path.basename(entry.relative)));
  return {
    canonicalProjectPath: root,
    lockfile,
    workspaceProject,
    packageRoots: packageFiles.map((file) => path.dirname(file.relative) || '.').sort(),
    protectedFiles,
    sourceFileCount: scan.files.length,
    sourceBytes: scan.bytes,
    omittedSensitiveFiles,
    warnings,
    sourceFingerprint: await fingerprintFiles(root, copiedFiles),
  };
}

/** @param {Record<string,unknown>} manifest @param {string} manifestDir @param {string} root @param {string} relative @param {string[]} problems */
function inspectDependencySpecs(manifest, manifestDir, root, relative, problems) {
  for (const section of DEPENDENCY_SECTIONS) {
    const record = manifest[section];
    if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
    for (const [name, raw] of Object.entries(record)) inspectDependencyValue(raw, `${relative} ${section}.${name}`, manifestDir, root, problems);
  }
  const pnpm = manifest.pnpm;
  if (pnpm && typeof pnpm === 'object' && !Array.isArray(pnpm)) inspectForbiddenPnpmKeys(pnpm, `${relative}.pnpm`, problems, true);
  const devEngines = manifest.devEngines;
  if (devEngines && typeof devEngines === 'object' && !Array.isArray(devEngines)) {
    const value = /** @type {Record<string,unknown>} */ (devEngines);
    if (value.runtime || value.packageManager) problems.push(`${relative} declares devEngines runtime/package-manager switching, which V0.1 refuses.`);
  }
}

/** @param {unknown} raw @param {string} label @param {string} manifestDir @param {string} root @param {string[]} problems */
function inspectDependencyValue(raw, label, manifestDir, root, problems) {
  if (typeof raw === 'string') {
    if (REMOTE_SPEC.test(raw) || /^git:|^git\/\//i.test(raw)) problems.push(`${label} uses a remote non-registry dependency spec.`);
    let localCandidate = raw;
    if (raw.startsWith('workspace:')) localCandidate = raw.slice('workspace:'.length);
    const isLocal = /^(?:file|link):/.test(localCandidate) || /^(?:\.{1,2}[\\/]|[A-Za-z]:[\\/]|\/)/.test(localCandidate);
    if (isLocal) inspectLocalPath(localCandidate, manifestDir, root, label, problems);
    return;
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw)) inspectDependencyValue(value, `${label}.${key}`, manifestDir, root, problems);
  }
}

/** @param {string} file @param {'npm'|'pnpm'} manager @param {string} root @param {string[]} problems */
async function inspectLockfile(file, manager, root, problems) {
  const label = path.basename(file);
  const text = await readFile(file, 'utf8');
  if (manager === 'npm') {
    let parsed;
    try { parsed = JSON.parse(text); } catch { problems.push(`${label} is not valid JSON.`); return; }
    inspectStructuredDependencyData(parsed, path.dirname(file), root, label, problems);
  } else {
    await inspectPnpmYaml(file, label, root, problems, true);
  }
}

/** @param {unknown} value @param {string} base @param {string} root @param {string} label @param {string[]} problems */
function inspectStructuredDependencyData(value, base, root, label, problems) {
  if (typeof value === 'string') {
    if (/^(?:file|link):/.test(value)) inspectLocalPath(value, base, root, label, problems);
    else if (/^(?:git(?:\+[^:]+)?:|git@|github:|gitlab:|bitbucket:|ssh:)/i.test(value)) problems.push(`${label} contains a Git/SSH dependency, which V0.1 refuses.`);
    else if (/^https?:/i.test(value)) inspectRegistryUrl(value, label, problems);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) inspectStructuredDependencyData(item, base, root, label, problems);
  } else if (value && typeof value === 'object') {
    const record = /** @type {Record<string,unknown>} */ (value);
    if (record.link === true && typeof record.resolved === 'string') inspectLocalPath(record.resolved, base, root, label, problems);
    for (const item of Object.values(value)) inspectStructuredDependencyData(item, base, root, label, problems);
  }
}

/** @param {string} value @param {string} base @param {string} root @param {string} label @param {string[]} problems */
function inspectLocalPath(value, base, root, label, problems) {
  let localValue = /^(?:file|link):/.test(value) ? value.slice(value.indexOf(':') + 1) : value;
  try { localValue = decodeURIComponent(localValue); } catch { problems.push(`${label} has an invalid encoded local dependency path.`); return; }
  const target = path.resolve(base, localValue.replaceAll('\\', path.sep));
  if (!isInside(root, target)) problems.push(`${label} contains a local dependency path outside the project root.`);
}

/** @param {string} file @param {string} label @param {string} root @param {string[]} problems @param {boolean} inspectRegistryKeys */
async function inspectPnpmYaml(file, label, root, problems, inspectRegistryKeys) {
  const text = await readFile(file, 'utf8');
  const documents = parseAllDocuments(text, { prettyErrors: false });
  if (documents.some((document) => document.errors.length)) {
    problems.push(`${label} is not valid YAML.`);
    return;
  }
  for (const document of documents) {
    const value = document.toJS({ maxAliasCount: 100 });
    inspectStructuredDependencyData(value, path.dirname(file), root, label, problems);
    inspectForbiddenPnpmKeys(value, label, problems, inspectRegistryKeys);
  }
}

/** @param {unknown} value @param {string} label @param {string[]} problems @param {boolean} inspectRegistryKeys @param {string[]} [parents] */
function inspectForbiddenPnpmKeys(value, label, problems, inspectRegistryKeys, parents = []) {
  if (Array.isArray(value)) {
    for (const item of value) inspectForbiddenPnpmKeys(item, label, problems, inspectRegistryKeys, parents);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    const normalized = key.replace(/[-_.]/g, '').toLowerCase();
    const executionKey = PNPM_EXECUTION_KEYS.has(normalized);
    const insideDependencyMap = parents.some((parent) => /^(?:dependencies|devdependencies|optionaldependencies|packages|snapshots|catalogs)$/.test(parent));
    const registryKey = inspectRegistryKeys && !insideDependencyMap && (PNPM_REGISTRY_KEYS.has(normalized) || /:registry$/i.test(key));
    if (executionKey || registryKey) problems.push(`${label} contains forbidden pnpm configuration key: ${key}`);
    inspectForbiddenPnpmKeys(item, `${label}.${key}`, problems, inspectRegistryKeys, [...parents, normalized]);
  }
}

/** @param {string} value @param {string} label @param {string[]} problems */
function inspectRegistryUrl(value, label, problems) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'registry.npmjs.org' || parsed.username || parsed.password || parsed.search || parsed.hash) {
      problems.push(`${label} contains a registry URL outside the V0.1 public HTTPS boundary.`);
    }
  } catch {
    problems.push(`${label} contains an invalid URL.`);
  }
}
