import { runAction } from './action.js';

void runAction().then((code) => { process.exitCode = code; }).catch((error) => {
  process.stderr.write(`Lockfile matrix action crashed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
