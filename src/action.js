import { appendFile, readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { DockerRunner } from './docker.js';
import { BoundaryError, UsageError } from './errors.js';
import { loadConfig } from './config.js';
import { runMatrix } from './core.js';
import { shouldFail } from './compare.js';
import { redact } from './util.js';
import { installInterruptionHandlers } from './signals.js';
import { renderActionSummary } from './report.js';

/** @param {{env?:NodeJS.ProcessEnv,runner?:DockerRunner}} [options] */
export async function runAction(options = {}) {
  const env = options.env ?? process.env;
  const workspace = env.GITHUB_WORKSPACE || process.cwd();
  const configInput = input(env, 'config');
  const failOn = parseFailOn(input(env, 'fail-on') || 'review');
  const runner = options.runner ?? new DockerRunner();
  const signals = installInterruptionHandlers(runner);
  try {
    const config = await loadConfig(configInput, { allowedRoot: workspace });
    const result = await runMatrix(config, { runner });
    await setOutput(env, 'verdict', result.verdict);
    await setOutput(env, 'report-json', result.jsonPath);
    await setOutput(env, 'report-markdown', result.markdownPath);
    if (env.GITHUB_STEP_SUMMARY) {
      const receipt = JSON.parse(await readFile(result.jsonPath, 'utf8'));
      await appendFile(env.GITHUB_STEP_SUMMARY, renderActionSummary(receipt), 'utf8');
    }
    return shouldFail(result.verdict, failOn) ? 1 : 0;
  } catch (error) {
    process.stderr.write(`Lockfile matrix action failed: ${redact(error instanceof Error ? error.message : String(error))}\n`);
    if (error instanceof BoundaryError) {
      for (const detail of error.details) process.stderr.write(`- ${redact(detail)}\n`);
    }
    return signals.interrupted ? 130 : 1;
  } finally {
    signals.remove();
  }
}

/** @param {NodeJS.ProcessEnv} env @param {string} name */
function input(env, name) {
  const value = env[`INPUT_${name.replaceAll(' ', '_').toUpperCase()}`] ?? '';
  if (name === 'config' && !value.trim()) throw new UsageError('Action input "config" is required.');
  return value.trim();
}

/** @param {string} value @returns {'regression'|'review'|'never'} */
function parseFailOn(value) {
  if (value !== 'regression' && value !== 'review' && value !== 'never') throw new UsageError('fail-on must be regression, review, or never.');
  return value;
}

/** @param {NodeJS.ProcessEnv} env @param {string} name @param {string} value */
async function setOutput(env, name, value) {
  if (!env.GITHUB_OUTPUT) return;
  if (/\r|\n/.test(value)) throw new Error(`Unsafe newline in Action output ${name}.`);
  const delimiter = `LOCKFILE_MATRIX_${randomBytes(10).toString('hex')}`;
  await appendFile(env.GITHUB_OUTPUT, `${name}<<${delimiter}\n${value}\n${delimiter}\n`, 'utf8');
}
