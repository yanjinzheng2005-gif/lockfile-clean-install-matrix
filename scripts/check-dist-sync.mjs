import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

const temporary = await mkdtemp(path.join(tmpdir(), 'lockfile-matrix-dist-'));
try {
  await cp('dist', path.join(temporary, 'dist'), { recursive: true });
  const result = spawnSync(process.execPath, ['scripts/build.mjs'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Rebuild failed:\n${result.stdout}\n${result.stderr}`);
  const before = await directoryDigest(path.join(temporary, 'dist'));
  const after = await directoryDigest('dist');
  if (before !== after) throw new Error('Committed/generated dist changed during a deterministic rebuild. Run npm run build and review the result.');
  console.log('Source/bundle deterministic rebuild check: PASS');
} finally {
  await rm(temporary, { recursive: true, force: true });
}

async function directoryDigest(root) {
  const rows = [];
  async function visit(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else rows.push(`${path.relative(root, absolute)}\0${createHash('sha256').update(await readFile(absolute)).digest('hex')}`);
    }
  }
  await visit(root);
  return createHash('sha256').update(rows.join('\n')).digest('hex');
}
