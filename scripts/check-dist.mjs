import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

for (const file of ['dist/cli.cjs', 'dist/action.cjs']) await access(file);
const cli = await readFile('dist/cli.cjs', 'utf8');
const action = await readFile('dist/action.cjs', 'utf8');
if (!cli.startsWith('#!/usr/bin/env node')) throw new Error('dist/cli.cjs is missing its executable shebang.');
if (!(await stat('dist/cli.cjs')).mode.toString(8).endsWith('755')) throw new Error('dist/cli.cjs is not executable.');
for (const required of ['--ignore-scripts', '--config.ignore-pnpmfile=true', 'no-new-privileges:true', '--cap-drop']) {
  if (!cli.includes(required) || !action.includes(required)) throw new Error(`Bundled entrypoints are missing boundary string: ${required}`);
}
for (const file of ['dist/cli.cjs', 'dist/action.cjs']) {
  const text = await readFile(file, 'utf8');
  if (text.includes(path.resolve('src'))) throw new Error(`${file} embeds a local source path.`);
  if (/Users\/[^/]+\//.test(text)) throw new Error(`${file} embeds a local user path.`);
}
console.log('Distribution content check: PASS');
