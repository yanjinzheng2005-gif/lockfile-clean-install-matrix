import test from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapManagerCommand, buildDockerRunArgs, DockerRunner, managerCommand } from '../src/docker.js';
import { processResult } from './helpers.js';
import { runProcess } from '../src/process.js';
import { cleanupRunRoot, createRunRoot } from '../src/workspace.js';
import { installInterruptionHandlers } from '../src/signals.js';

test('Docker argv enforces the V0.1 isolation boundary', () => {
  const args = buildDockerRunArgs({ name: 'fixture', image: 'node:24.16.0-bookworm-slim', uid: 1000, gid: 1000, projectDir: '/tmp/run/project', cacheDir: '/tmp/run/cache', registry: 'https://registry.npmjs.org', command: ['node', '--version'] });
  const joined = args.join(' ');
  for (const required of ['--read-only', '--cap-drop ALL', 'no-new-privileges:true', '--network bridge', '--user 1000:1000', 'NPM_CONFIG_IGNORE_SCRIPTS=true']) assert.ok(joined.includes(required), required);
  for (const forbidden of ['--privileged', '--network host', 'docker.sock', '--env-file', 'GITHUB_TOKEN', 'process.env']) assert.equal(joined.includes(forbidden), false, forbidden);
  assert.equal(args.filter((value) => value.startsWith('type=bind')).length, 2);
});

test('manager argv fixes exact versions and disables scripts and pnpm hooks', () => {
  const npm = managerCommand('npm', '11.14.1', 'install', 'https://registry.npmjs.org').join(' ');
  const pnpm = managerCommand('pnpm', '11.17.0', 'install', 'https://registry.npmjs.org').join(' ');
  const npmBootstrap = bootstrapManagerCommand('npm', '11.14.1', 'https://registry.npmjs.org').join(' ');
  const pnpmBootstrap = bootstrapManagerCommand('pnpm', '12.0.0-beta.0', 'https://registry.npmjs.org').join(' ');
  const pnpmInventory = managerCommand('pnpm', '11.17.0', 'inventory', 'https://registry.npmjs.org').join(' ');
  const npmWorkspaceInventory = managerCommand('npm', '11.14.1', 'inventory', 'https://registry.npmjs.org', { workspaceProject: true }).join(' ');
  assert.ok(npmBootstrap.includes('npm@11.14.1'));
  assert.ok(npmBootstrap.includes('--ignore-scripts'));
  assert.ok(npm.includes('--ignore-scripts'));
  assert.ok(pnpmBootstrap.includes('pnpm@12.0.0-beta.0'));
  assert.ok(pnpmBootstrap.includes('--ignore-scripts=false'));
  assert.ok(pnpm.includes('--config.ignore-pnpmfile=true'));
  assert.ok(pnpm.includes('--config.manage-package-manager-versions=false'));
  assert.ok(pnpm.includes('--frozen-lockfile'));
  assert.ok(pnpmInventory.includes('--recursive'));
  assert.ok(pnpmInventory.includes('--config.include-workspace-root=true'));
  assert.ok(npm.includes('/matrix-cache/project-npm-cache'));
  assert.ok(npmWorkspaceInventory.includes('--workspaces'));
  assert.ok(npmWorkspaceInventory.includes('--include-workspace-root'));
});

test('manager bootstrap container never mounts the project', () => {
  const args = buildDockerRunArgs({
    name: 'bootstrap', image: 'sha256:fixture', uid: 1000, gid: 1000,
    cacheDir: '/tmp/run/cache', registry: 'https://registry.npmjs.org',
    command: bootstrapManagerCommand('pnpm', '12.0.0-beta.0', 'https://registry.npmjs.org'),
  });
  assert.equal(args.filter((value) => value.startsWith('type=bind')).length, 1);
  assert.equal(args.some((value) => value.includes('/workspace')), false);
  assert.ok(args.includes('/tmp'));
});

test('runProcess waits for timeout cleanup before resolving', async () => {
  let cleanupFinished = false;
  const result = await runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    timeoutMs: 50,
    onTimeout: async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      cleanupFinished = true;
    },
  });
  assert.equal(result.timedOut, true);
  assert.equal(cleanupFinished, true);
});

test('temporary cleanup refuses directories it did not create', async () => {
  await assert.rejects(cleanupRunRoot('/tmp'), /Refusing/);
  const root = await createRunRoot();
  await cleanupRunRoot(root);
});

test('container cleanup accepts an explicit no-such-container result', async () => {
  const runner = new DockerRunner({ execute: async (_command, args) => args[0] === 'rm'
    ? processResult({ exitCode: 1, stderr: 'Error: No such container: fixture' })
    : processResult({ exitCode: 1, stderr: 'Error: No such object: fixture' }) });
  await runner.forceRemove('fixture');
});

test('container cleanup does not mistake a disconnected daemon for successful removal', async () => {
  const runner = new DockerRunner({ execute: async () => processResult({ exitCode: 1, stderr: 'Cannot connect to the Docker daemon' }) });
  await assert.rejects(runner.forceRemove('fixture'), /could not prove/);
});

test('container cleanup does not mistake a missing Docker context for a missing container', async () => {
  const runner = new DockerRunner({ execute: async () => processResult({ exitCode: 1, stderr: 'docker context default not found' }) });
  await assert.rejects(runner.forceRemove('fixture'), /could not prove/);
});

test('SIGTERM handler interrupts the runner and records the interrupted state', async () => {
  let called = false;
  const runner = { interrupt: async () => { called = true; } };
  const before = new Set(process.listeners('SIGTERM'));
  const signals = installInterruptionHandlers(runner);
  const handler = process.listeners('SIGTERM').find((candidate) => !before.has(candidate));
  assert.ok(handler);
  handler();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(called, true);
  assert.equal(signals.interrupted, true);
  signals.remove();
});
