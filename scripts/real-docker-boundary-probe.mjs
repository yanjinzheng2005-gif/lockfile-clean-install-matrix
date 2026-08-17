import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { buildDockerRunArgs, DockerRunner } from '../src/docker.js';
import { protectedFileDiff, snapshotProtectedFiles } from '../src/mutation.js';
import { cleanupRunRoot, createRunRoot } from '../src/workspace.js';

const runRoot = await createRunRoot();
const runner = new DockerRunner();
try {
  const image = await runner.prepare({ nodeVersion: '24.16.0', runRoot });
  const projectDir = path.join(runRoot, 'probe-project');
  const cacheDir = path.join(runRoot, 'probe-cache');
  await mkdir(projectDir, { recursive: true });
  await mkdir(cacheDir, { recursive: true });
  await writeFile(path.join(projectDir, 'package.json'), '{"name":"docker-probe","version":"1.0.0","private":true}\n');
  await writeFile(path.join(projectDir, 'package-lock.json'), '{"name":"docker-probe","version":"1.0.0","lockfileVersion":3,"packages":{"":{"name":"docker-probe","version":"1.0.0"}}}\n');

  const hangName = `lockfile-matrix-real-hang-${randomBytes(4).toString('hex')}`;
  runner.activeContainers.add(hangName);
  const hangArgs = buildDockerRunArgs({
    name: hangName,
    image: runner.image,
    uid: runner.uid,
    gid: runner.gid,
    projectDir,
    cacheDir,
    registry: 'https://registry.npmjs.org',
    command: ['node', '-e', 'setInterval(() => {}, 1000)'],
  });
  const hang = await runner.execute(runner.command, hangArgs, {
    env: runner.hostEnv,
    timeoutMs: 1000,
    maxOutputBytes: 65536,
    signal: runner.abortController.signal,
    onTimeout: async () => runner.forceRemove(hangName),
  });
  assert.equal(hang.timedOut, true);
  assert.equal(hang.cleanupError, null);
  const hangInspect = await runner.execDocker(['container', 'inspect', hangName], 10000, false);
  assert.notEqual(hangInspect.exitCode, 0);
  assert.match(`${hangInspect.stdout}\n${hangInspect.stderr}`, /No such (?:object|container)/i);

  const mutationBefore = await snapshotProtectedFiles(projectDir);
  const mutationName = `lockfile-matrix-real-mutation-${randomBytes(4).toString('hex')}`;
  runner.activeContainers.add(mutationName);
  const mutationArgs = buildDockerRunArgs({
    name: mutationName,
    image: runner.image,
    uid: runner.uid,
    gid: runner.gid,
    projectDir,
    cacheDir,
    registry: 'https://registry.npmjs.org',
    command: ['node', '-e', "require('node:fs').writeFileSync('package-lock.json', '{\\"mutated\\":true}\\n')"],
  });
  const mutationRun = await runner.execute(runner.command, mutationArgs, {
    env: runner.hostEnv,
    timeoutMs: 30000,
    maxOutputBytes: 65536,
    signal: runner.abortController.signal,
  });
  assert.equal(mutationRun.exitCode, 0, mutationRun.stderr);
  await runner.confirmGone(mutationName);
  runner.activeContainers.delete(mutationName);
  const mutationDiff = protectedFileDiff(mutationBefore, await snapshotProtectedFiles(projectDir));
  assert.deepEqual(mutationDiff.map((item) => item.path), ['package-lock.json']);

  await mkdir('validation-results', { recursive: true });
  await writeFile('validation-results/docker-boundary-probe.json', `${JSON.stringify({
    schemaVersion: 1,
    image,
    hang: { timedOut: hang.timedOut, cleanupError: hang.cleanupError, containerRemoved: true },
    mutation: { exitCode: mutationRun.exitCode, protectedFileDiff: mutationDiff },
  }, null, 2)}\n`);
  console.log('Real Docker timeout/removal and protected-file mutation probe: PASS');
} finally {
  await runner.dispose();
  await cleanupRunRoot(runRoot);
}
