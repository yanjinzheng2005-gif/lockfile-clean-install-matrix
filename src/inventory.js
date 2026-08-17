import { lstat, readdir, readFile, readlink } from 'node:fs/promises';
import path from 'node:path';
import { isInside, sha256, stableJson } from './util.js';

/**
 * @typedef {object} InventoryRow
 * @property {string} importer
 * @property {string} ancestry
 * @property {string} alias
 * @property {string} name
 * @property {string} version
 * @property {string[]} flags
 */

/** @param {'npm'|'pnpm'} manager @param {string} raw */
export function normalizeInventory(manager, raw) {
  const parsed = parseJsonOutput(raw);
  /** @type {InventoryRow[]} */
  const rows = [];
  if (manager === 'npm') normalizeNpm(parsed, rows);
  else normalizePnpm(parsed, rows);
  rows.sort((a, b) => stableJson(a).localeCompare(stableJson(b)));
  return {
    rows,
    digest: sha256(stableJson(rows)),
  };
}

/** @param {string} raw */
export function parseJsonOutput(raw) {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('Package manager returned no inventory JSON.');
  try { return JSON.parse(trimmed); } catch { throw new Error('Package manager inventory stdout was not exactly one valid JSON document.'); }
}

/** @param {unknown} value @param {InventoryRow[]} rows */
function normalizeNpm(value, rows) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('npm inventory root must be an object.');
  const root = /** @type {Record<string,unknown>} */ (value);
  if (typeof root.name !== 'string' && typeof root.path !== 'string') throw new Error('npm inventory root lacks a project identity.');
  const importer = safeString(root.name) || '.';
  visitDependencies(root.dependencies, importer, [], rows, 'prod');
}

/** @param {unknown} value @param {InventoryRow[]} rows */
function normalizePnpm(value, rows) {
  const projects = Array.isArray(value) ? value : [value];
  if (!projects.length) throw new Error('pnpm inventory contains no projects.');
  for (let index = 0; index < projects.length; index += 1) {
    const project = projects[index];
    if (!project || typeof project !== 'object' || Array.isArray(project)) continue;
    const record = /** @type {Record<string,unknown>} */ (project);
    if (typeof record.name !== 'string' && typeof record.path !== 'string') throw new Error('pnpm inventory project lacks a project identity.');
    const importer = safeString(record.name) || `workspace-${index}`;
    visitDependencies(record.dependencies, importer, [], rows, 'prod');
    visitDependencies(record.devDependencies, importer, [], rows, 'dev');
    visitDependencies(record.optionalDependencies, importer, [], rows, 'optional');
  }
}

/**
 * @param {unknown} value
 * @param {string} importer
 * @param {string[]} ancestors
 * @param {InventoryRow[]} rows
 * @param {string} section
 */
function visitDependencies(value, importer, ancestors, rows, section) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  for (const [alias, rawNode] of Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) {
    const node = /** @type {Record<string,unknown>} */ (rawNode && typeof rawNode === 'object' && !Array.isArray(rawNode)
      ? rawNode
      : { version: rawNode });
    const name = safeString(node.name) || alias;
    const version = safeString(node.version) || safeString(rawNode) || 'UNKNOWN';
    const marker = `${alias}:${name}@${version}`;
    const ancestry = [...ancestors, marker];
    const flags = [section];
    for (const flag of ['dev', 'extraneous', 'invalid', 'link', 'missing', 'optional', 'peer']) {
      if (node[flag] === true) flags.push(flag);
    }
    rows.push({ importer, ancestry: ancestry.join('>'), alias, name, version, flags: [...new Set(flags)].sort() });
    if (ancestry.length > 256) throw new Error('Dependency inventory exceeds the maximum supported depth.');
    if (rows.length > 100000) throw new Error('Dependency inventory exceeds 100000 rows.');
    visitDependencies(node.dependencies, importer, ancestry, rows, section);
    visitDependencies(node.optionalDependencies, importer, ancestry, rows, 'optional');
  }
}

/** @param {unknown} value */
function safeString(value) {
  return typeof value === 'string' ? value : '';
}

/** @param {string} projectRoot @param {string[]} [packageRoots] */
export async function readBinShims(projectRoot, packageRoots = ['.']) {
  const rows = [];
  for (const packageRoot of [...new Set(packageRoots)].sort()) {
    const directory = path.join(projectRoot, packageRoot, 'node_modules', '.bin');
    try {
      for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isFile() && !entry.isSymbolicLink()) continue;
        const absolute = path.join(directory, entry.name);
        const info = await lstat(absolute);
        if (info.isSymbolicLink()) {
          const target = await readlink(absolute);
          const resolved = path.resolve(directory, target);
          const normalizedTarget = path.isAbsolute(target)
            ? isInside(projectRoot, resolved) ? `$PROJECT/${path.relative(projectRoot, resolved)}` : '$OUTSIDE_PROJECT'
            : target.split(path.sep).join('/');
          rows.push(`${packageRoot}:${entry.name}->${normalizedTarget}`);
        } else {
          rows.push(`${packageRoot}:${entry.name}#sha256:${sha256(await readFile(absolute))}`);
        }
      }
    } catch {}
  }
  return rows;
}
