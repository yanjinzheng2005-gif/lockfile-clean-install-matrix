import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const files = [];
for (const directory of ['src', 'scripts', 'tests']) {
  for (const name of await readdir(directory)) {
    if (name.endsWith('.js') || name.endsWith('.mjs')) files.push(`${directory}/${name}`);
  }
}
for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Syntax check failed for ${file}:\n${result.stderr || result.stdout}`);
}
console.log(`JavaScript syntax check: PASS (${files.length} files)`);
