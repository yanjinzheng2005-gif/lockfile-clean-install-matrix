import { pathToFileURL } from 'node:url';
import { DockerRunner } from './docker.js';
import { BoundaryError, EnvironmentError, UsageError } from './errors.js';
import { loadConfig } from './config.js';
import { runMatrix } from './core.js';
import { shouldFail } from './compare.js';
import { redact } from './util.js';
import { installInterruptionHandlers } from './signals.js';

/** @param {string[]} argv @param {{runner?:DockerRunner,allowedRoot?:string}} [options] */
export async function main(argv = process.argv.slice(2), options = {}) {
  const runner = options.runner ?? new DockerRunner();
  const signals = installInterruptionHandlers(runner);
  try {
    const parsed = parseArguments(argv);
    const config = await loadConfig(parsed.config, { allowedRoot: options.allowedRoot ?? process.cwd() });
    const result = await runMatrix(config, { runner });
    process.stdout.write(`Verdict: ${result.verdict}\nJSON: ${result.jsonPath}\nMarkdown: ${result.markdownPath}\n`);
    return shouldFail(result.verdict, parsed.failOn) ? 1 : 0;
  } catch (error) {
    const message = redact(error instanceof Error ? error.message : String(error));
    process.stderr.write(`Lockfile matrix failed: ${message}\n`);
    if (error instanceof BoundaryError) {
      for (const detail of error.details) process.stderr.write(`- ${redact(detail)}\n`);
    }
    if (signals.interrupted) return 130;
    if (error instanceof UsageError || error instanceof BoundaryError) return 2;
    if (error instanceof EnvironmentError) return 3;
    return 4;
  } finally {
    signals.remove();
  }
}

/** @param {string[]} argv */
export function parseArguments(argv) {
  if (argv[0] !== 'run') throw new UsageError('Usage: lockfile-clean-install-matrix run --config <file> [--fail-on regression|review|never]');
  let config = '';
  /** @type {'regression'|'review'|'never'} */
  let failOn = 'review';
  for (let index = 1; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--config') config = argv[++index] ?? '';
    else if (value === '--fail-on') {
      const requested = argv[++index];
      if (requested !== 'regression' && requested !== 'review' && requested !== 'never') {
        throw new UsageError('--fail-on must be regression, review, or never.');
      }
      failOn = requested;
    } else {
      throw new UsageError(`Unknown argument: ${value}`);
    }
  }
  if (!config) throw new UsageError('--config is required.');
  return { config, failOn };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
