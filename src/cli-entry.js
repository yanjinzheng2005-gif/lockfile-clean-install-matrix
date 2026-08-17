import { main } from './cli.js';

void main().then((code) => { process.exitCode = code; }).catch((error) => {
  process.stderr.write(`Lockfile matrix CLI crashed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 4;
});
