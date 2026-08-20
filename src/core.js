import path from 'node:path';
import { homedir } from 'node:os';
import { compareLegs } from './compare.js';
import { DockerRunner } from './docker.js';
import { EnvironmentError } from './errors.js';
import { normalizeInventory, readBinShims } from './inventory.js';
import { protectedFileDiff, snapshotProtectedFiles } from './mutation.js';
import { preflight } from './preflight.js';
import { writeReports } from './report.js';
import { redact } from './util.js';
import { cleanupRunRoot, copyProject, createRunRoot } from './workspace.js';

export const TOOL_VERSION = '0.1.0';
const NETWORK_ERROR = /\b(?:EAI_AGAIN|ENOTFOUND|ECONNRESET|ECONNREFUSED|ECONNABORTED|EHOSTUNREACH|ENETUNREACH|EPIPE|ETIMEDOUT|UND_ERR_(?:CONNECT_TIMEOUT|HEADERS_TIMEOUT|BODY_TIMEOUT|SOCKET|CONNECT|REQUEST_ABORTED)|ERR_SOCKET_TIMEOUT|ERR_TLS_[A-Z_]+|ERR_PNPM_FETCH_(?:408|425|429|5\d\d)|CERT_HAS_EXPIRED|UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT|HTTP\s+(?:408|425|429|5\d\d)|status(?:Code)?[=: ]+(?:408|425|429|5\d\d))\b/i;

/**
 * @typedef {object} LegReceipt
 * @property {'baseline'|'candidate'} label
 * @property {string} requestedVersion
 * @property {string} observedVersion
 * @property {'PASS'|'INSTALL_FAILED'|'HANG'|'MUTATED'|'NETWORK_INCONCLUSIVE'|'INVENTORY_INCONCLUSIVE'|'ENVIRONMENT_ERROR'} status
 * @property {number|null} installExitCode
 * @property {number} installDurationMs
 * @property {boolean} outputTruncated
 * @property {string} installLog
 * @property {Array<{path:string,before:string,after:string}>} mutations
 * @property {{rows:import('./inventory.js').InventoryRow[],digest:string}|null} inventory
 * @property {string[]} binShims
 * @property {string[]} warnings
 */

/**
 * @typedef {object} MatrixReceipt
 * @property {1} schemaVersion
 * @property {string} toolVersion
 * @property {string} generatedAt
 * @property {{manager:'npm'|'pnpm',baselineVersion:string,candidateVersion:string,nodeVersion:string,registry:string}} config
 * @property {{image:{reference:string,id:string,repoDigest:string,platform:string,dockerVersion:string,containerUser:string},managerBootstrap:{projectMounted:false,projectLifecycleScripts:'disabled',pnpmPackageBootstrapScripts:'allowed-in-projectless-container'}}} environment
 * @property {import('./preflight.js').PreflightResult} preflight
 * @property {LegReceipt} baseline
 * @property {LegReceipt} candidate
 * @property {{verdict:string,reasons:string[],dependencyDiff:{onlyBaseline:unknown[],onlyCandidate:unknown[],totalOnlyBaseline:number,totalOnlyCandidate:number,truncated:boolean},binDiff:{onlyBaseline:string[],onlyCandidate:string[]}}} comparison
 * @property {boolean} sourceUnchanged
 * @property {string} reproduceCommand
 */

/**
 * @param {import('./config.js').MatrixConfig} config
 * @param {{runner?:DockerRunner,now?:()=>Date}} [options]
 */
export async function runMatrix(config, options = {}) {
  const runner = options.runner ?? new DockerRunner();
  const now = options.now ?? (() => new Date());
  const initialPreflight = await preflight(config);
  const originalProtectedBefore = await snapshotProtectedFiles(config.projectPath);
  const runRoot = await createRunRoot();
  let cleanupError = null;
  try {
    const baselineDir = path.join(runRoot, 'baseline', 'project');
    const candidateDir = path.join(runRoot, 'candidate', 'project');
    await copyProject(config.projectPath, baselineDir, { excludePaths: new Set([config.outputDir]) });
    await copyProject(config.projectPath, candidateDir, { excludePaths: new Set([config.outputDir]) });
    await assertCopyMatches(initialPreflight, config, baselineDir, runRoot);
    await assertCopyMatches(initialPreflight, config, candidateDir, runRoot);

    const image = await runner.prepare({ nodeVersion: config.nodeVersion, runRoot });
    const baseline = await executeLeg(runner, config, 'baseline', config.baselineVersion, baselineDir, path.join(runRoot, 'baseline', 'cache'), runRoot, initialPreflight.workspaceProject, initialPreflight.packageRoots);
    const candidate = await executeLeg(runner, config, 'candidate', config.candidateVersion, candidateDir, path.join(runRoot, 'candidate', 'cache'), runRoot, initialPreflight.workspaceProject, initialPreflight.packageRoots);
    runner.assertNotInterrupted();
    const comparison = compareLegs(baseline, candidate);

    const finalPreflight = await preflight(config);
    const originalProtectedAfter = await snapshotProtectedFiles(config.projectPath);
    const sourceUnchanged = initialPreflight.sourceFingerprint === finalPreflight.sourceFingerprint
      && protectedFileDiff(originalProtectedBefore, originalProtectedAfter).length === 0;
    if (!sourceUnchanged) comparison.reasons.push('The original source changed during the run, so the receipt cannot be treated as deterministic.');
    if (!sourceUnchanged) comparison.verdict = 'INCONCLUSIVE';

    /** @type {MatrixReceipt} */
    const receipt = {
      schemaVersion: 1,
      toolVersion: TOOL_VERSION,
      generatedAt: now().toISOString(),
      config: {
        manager: config.manager,
        baselineVersion: config.baselineVersion,
        candidateVersion: config.candidateVersion,
        nodeVersion: config.nodeVersion,
        registry: config.registry,
      },
      environment: {
        image,
        managerBootstrap: {
          projectMounted: false,
          projectLifecycleScripts: 'disabled',
          pnpmPackageBootstrapScripts: 'allowed-in-projectless-container',
        },
      },
      preflight: initialPreflight,
      baseline,
      candidate,
      comparison,
      sourceUnchanged,
      reproduceCommand: `lockfile-clean-install-matrix run --config ${shellQuote(path.relative(config.allowedRoot, config.configPath).split(path.sep).join('/'))} --fail-on review`,
    };
    const reports = await writeReports(receipt, config.outputDir, {
      projectRoot: config.projectPath,
      runRoot,
      outputDir: config.outputDir,
      home: homedir(),
    });
    runner.assertNotInterrupted();
    return { ...reports, verdict: reports.receipt.comparison.verdict };
  } finally {
    try { await runner.dispose(); } catch (error) { cleanupError = error; }
    try { await cleanupRunRoot(runRoot); } catch (error) { cleanupError ??= error; }
    if (cleanupError) throw cleanupError;
  }
}

/** @param {DockerRunner} runner @param {import('./config.js').MatrixConfig} config @param {'baseline'|'candidate'} label @param {string} version @param {string} projectDir @param {string} cacheDir @param {string} runRoot @param {boolean} workspaceProject @param {string[]} packageRoots */
async function executeLeg(runner, config, label, version, projectDir, cacheDir, runRoot, workspaceProject, packageRoots) {
  const before = await snapshotProtectedFiles(projectDir);
  const raw = await runner.runLeg({
    label,
    manager: config.manager,
    version,
    registry: config.registry,
    timeoutSeconds: config.timeoutSeconds,
    projectDir,
    cacheDir,
    workspaceProject,
  });
  const after = await snapshotProtectedFiles(projectDir);
  const mutations = protectedFileDiff(before, after);
  const managerLog = logText(raw.managerResult, config.projectPath, runRoot);
  const installLog = logText(raw.installResult, config.projectPath, runRoot);
  /** @type {LegReceipt['status']} */
  let status = 'ENVIRONMENT_ERROR';
  /** @type {LegReceipt['inventory']} */
  let inventory = null;
  /** @type {string[]} */
  const warnings = [];

  if (mutations.length) {
    status = 'MUTATED';
  } else if (raw.managerResult.timedOut || raw.managerResult.outputTruncated || raw.managerResult.cleanupError || raw.managerResult.exitCode !== 0 || raw.managerObserved !== version) {
    warnings.push(raw.managerObserved && raw.managerObserved !== version
      ? `Requested ${version} but observed ${raw.managerObserved}.`
      : 'The exact package-manager version could not be prepared.');
  } else if (!raw.installResult) {
    warnings.push('The install phase did not start.');
  } else if (raw.installResult.cleanupError) {
    status = 'ENVIRONMENT_ERROR';
    warnings.push(`Timed-out container cleanup failed: ${raw.installResult.cleanupError}`);
  } else if (raw.installResult.timedOut) {
    status = 'HANG';
  } else if (raw.installResult.exitCode !== 0) {
    status = NETWORK_ERROR.test(`${raw.installResult.stdout}\n${raw.installResult.stderr}`) ? 'NETWORK_INCONCLUSIVE' : 'INSTALL_FAILED';
  } else if (!raw.inventoryResult || raw.inventoryResult.timedOut || raw.inventoryResult.outputTruncated || raw.inventoryResult.cleanupError || raw.inventoryResult.exitCode !== 0) {
    status = 'INVENTORY_INCONCLUSIVE';
    warnings.push(raw.inventoryResult?.outputTruncated
      ? 'The install passed but the dependency inventory exceeded the evidence limit and was truncated.'
      : raw.inventoryResult?.exitCode !== undefined && raw.inventoryResult.exitCode !== 0
        ? `The install passed but the inventory command exited ${raw.inventoryResult.exitCode}.`
        : 'The install passed but the dependency inventory could not finish.');
  } else {
    try {
      inventory = normalizeInventory(config.manager, raw.inventoryResult.stdout);
      status = 'PASS';
    } catch (error) {
      status = 'INVENTORY_INCONCLUSIVE';
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    label,
    requestedVersion: version,
    observedVersion: raw.managerObserved,
    status,
    installExitCode: raw.installResult?.exitCode ?? null,
    installDurationMs: raw.installResult?.durationMs ?? raw.managerResult.durationMs,
    outputTruncated: Boolean(raw.managerResult.outputTruncated || raw.installResult?.outputTruncated || raw.inventoryResult?.outputTruncated),
    installLog: installLog || managerLog,
    mutations,
    inventory,
    binShims: status === 'PASS' ? await readBinShims(projectDir, packageRoots) : [],
    warnings,
  };
}

/** @param {import('./preflight.js').PreflightResult} expected @param {import('./config.js').MatrixConfig} config @param {string} projectDir @param {string} runRoot */
async function assertCopyMatches(expected, config, projectDir, runRoot) {
  const copyConfig = { ...config, allowedRoot: runRoot, projectPath: projectDir, outputDir: path.join(runRoot, 'discarded-output') };
  const observed = await preflight(copyConfig);
  if (observed.sourceFingerprint !== expected.sourceFingerprint) {
    throw new EnvironmentError('The isolated project copy does not match the preflighted source.');
  }
}

/** @param {import('./process.js').ProcessResult|null} result @param {string} projectRoot @param {string} runRoot */
function logText(result, projectRoot, runRoot) {
  if (!result) return '';
  return redact(`${result.stdout}${result.stderr ? `\n${result.stderr}` : ''}`, { projectRoot, runRoot, home: homedir() }).slice(0, 65536);
}

/** @param {string} value */
function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
