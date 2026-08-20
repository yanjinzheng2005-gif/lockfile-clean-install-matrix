import { mkdir, realpath, rename, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { redactValue } from './util.js';

export const REPORT_JSON = 'lockfile-matrix-report.json';
export const REPORT_MARKDOWN = 'lockfile-matrix-report.md';

/**
 * @param {import('./core.js').MatrixReceipt} receipt
 * @param {string} outputDir
 * @param {{projectRoot:string,runRoot:string,outputDir:string,home?:string}} replacements
 */
export async function writeReports(receipt, outputDir, replacements) {
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  if (await realpath(outputDir) !== outputDir) throw new Error('outputDir changed after configuration validation.');
  const safeReceipt = /** @type {import('./core.js').MatrixReceipt} */ (redactValue(receipt, replacements));
  const jsonPath = path.join(outputDir, REPORT_JSON);
  const markdownPath = path.join(outputDir, REPORT_MARKDOWN);
  await atomicWrite(jsonPath, `${JSON.stringify(safeReceipt, null, 2)}\n`);
  await atomicWrite(markdownPath, renderMarkdown(safeReceipt));
  return { jsonPath, markdownPath, receipt: safeReceipt };
}

/** @param {import('./core.js').MatrixReceipt} receipt */
export function renderMarkdown(receipt) {
  const lines = [
    '# Lockfile Clean Install Matrix receipt',
    '',
    `- Verdict: **${inline(receipt.comparison.verdict)}**`,
    `- Manager: \`${inline(receipt.config.manager)}\``,
    `- Versions: \`${inline(receipt.config.baselineVersion)}\` → \`${inline(receipt.config.candidateVersion)}\``,
    `- Node image: \`${inline(receipt.environment.image.reference)}\``,
    `- Generated: ${inline(receipt.generatedAt)}`,
    '',
    '## What this receipt proves',
    '',
    'It compares two exact versions of the same package manager in separate Linux/amd64 cold-install copies. Project lifecycle scripts and pnpm hooks are disabled. The original project is never mounted into a container.',
    '',
    'It does **not** prove application behavior, vulnerability status, license compliance, private-registry compatibility, or network isolation. Containers retain ordinary outbound network access so the public npm registry can be reached.',
    '',
    '## Matrix',
    '',
    '| Leg | Requested | Observed | Status | Install exit | Duration | Tree digest | Protected changes |',
    '|---|---:|---:|---|---:|---:|---|---:|',
    legRow(receipt.baseline),
    legRow(receipt.candidate),
    '',
    '## Comparison',
    '',
    ...receipt.comparison.reasons.map((reason) => `- ${inline(reason)}`),
    `- Dependency rows only in baseline: ${receipt.comparison.dependencyDiff.totalOnlyBaseline}${receipt.comparison.dependencyDiff.truncated ? ` (first ${receipt.comparison.dependencyDiff.onlyBaseline.length} retained in JSON)` : ''}`,
    `- Dependency rows only in candidate: ${receipt.comparison.dependencyDiff.totalOnlyCandidate}${receipt.comparison.dependencyDiff.truncated ? ` (first ${receipt.comparison.dependencyDiff.onlyCandidate.length} retained in JSON)` : ''}`,
    `- Bin shims only in baseline: ${receipt.comparison.binDiff.onlyBaseline.map(inline).join(', ') || 'none'}`,
    `- Bin shims only in candidate: ${receipt.comparison.binDiff.onlyCandidate.map(inline).join(', ') || 'none'}`,
    '',
    '## Safety boundary',
    '',
    `- Original source unchanged during run: **${receipt.sourceUnchanged ? 'yes' : 'no'}**`,
    `- Source files inspected: ${receipt.preflight.sourceFileCount}`,
    `- Sensitive files omitted: ${receipt.preflight.omittedSensitiveFiles.length}`,
    '- Container: non-root, read-only root filesystem, all Linux capabilities dropped, no-new-privileges, bounded CPU/memory/PIDs.',
    '- No host HOME, credentials, SSH material, Git config, Docker socket, or parent environment is mounted or forwarded.',
    '- Exact package managers are bootstrapped in a separate container with no project mount. pnpm package bootstrap scripts may run there because pnpm 12 uses them to install its native binary; project dependency scripts remain disabled.',
    '',
    '## Reproduce',
    '',
    '```sh',
    receipt.reproduceCommand,
    '```',
    '',
  ];
  for (const leg of [receipt.baseline, receipt.candidate]) {
    lines.push(`## ${leg.label} diagnostics`, '', `Status: **${inline(leg.status)}**`, '');
    if (leg.warnings.length) lines.push('Warnings:', '', ...leg.warnings.map((warning) => `- ${inline(warning)}`), '');
    if (leg.mutations.length) {
      lines.push('Protected file changes:', '', ...leg.mutations.map((item) => `- \`${inline(item.path)}\`: ${inline(item.before)} → ${inline(item.after)}`), '');
    }
    if (leg.installLog) lines.push('Install log (indented to prevent Markdown injection):', '', ...leg.installLog.split(/\r?\n/).map((line) => `    ${line}`), '');
  }
  return `${lines.join('\n')}\n`;
}

/** @param {import('./core.js').MatrixReceipt} receipt */
export function renderActionSummary(receipt) {
  return [
    '# Lockfile Clean Install Matrix',
    '',
    `- Verdict: **${inline(receipt.comparison.verdict)}**`,
    `- Manager: \`${inline(receipt.config.manager)}\``,
    `- Baseline: \`${inline(receipt.config.baselineVersion)}\` — **${inline(receipt.baseline.status)}**`,
    `- Candidate: \`${inline(receipt.config.candidateVersion)}\` — **${inline(receipt.candidate.status)}**`,
    `- Original source unchanged: **${receipt.sourceUnchanged ? 'yes' : 'no'}**`,
    '',
    'Raw diagnostic logs are intentionally omitted from the step summary. Use the JSON/Markdown receipt artifact for details.',
    '',
  ].join('\n');
}

/** @param {import('./core.js').LegReceipt} leg */
function legRow(leg) {
  return `| ${inline(leg.label)} | ${inline(leg.requestedVersion)} | ${inline(leg.observedVersion || '—')} | ${inline(leg.status)} | ${leg.installExitCode ?? '—'} | ${leg.installDurationMs} ms | ${inline(leg.inventory?.digest ?? '—')} | ${leg.mutations.length} |`;
}

/** @param {unknown} value */
function inline(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('`', '\\`').replace(/[\r\n]+/g, ' ');
}

/** @param {string} destination @param {string} contents */
async function atomicWrite(destination, contents) {
  const temporary = `${destination}.${randomBytes(6).toString('hex')}.tmp`;
  if (await realpath(path.dirname(destination)) !== path.dirname(destination)) throw new Error('outputDir changed before report write.');
  await writeFile(temporary, contents, { mode: 0o600, flag: 'wx' });
  await rename(temporary, destination);
}
