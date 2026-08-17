import { spawnSync } from 'node:child_process';

const inside = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' });
if (inside.status !== 0 || inside.stdout.trim() !== 'true') throw new Error('Committed dist check requires a Git worktree.');
for (const file of ['dist/cli.cjs', 'dist/action.cjs']) {
  const tracked = spawnSync('git', ['ls-files', '--error-unmatch', file], { encoding: 'utf8' });
  if (tracked.status !== 0) throw new Error(`${file} is not tracked by Git.`);
}
const diff = spawnSync('git', ['diff', '--exit-code', 'HEAD', '--', 'dist'], { encoding: 'utf8' });
if (diff.status !== 0) {
  if (diff.stdout) process.stderr.write(diff.stdout);
  if (diff.stderr) process.stderr.write(diff.stderr);
  throw new Error('Committed dist/ does not match the source-built result. Build and commit dist before release.');
}
console.log('Committed source/bundle consistency check: PASS');
