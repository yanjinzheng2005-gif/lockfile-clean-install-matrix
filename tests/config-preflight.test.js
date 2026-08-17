import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, validateConfig } from '../src/config.js';
import { preflight } from '../src/preflight.js';
import { BoundaryError, UsageError } from '../src/errors.js';
import { createNpmFixture } from './helpers.js';

test('loads a contained exact-version config', async (t) => {
  const fixture = await createNpmFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const config = await loadConfig(fixture.configPath, { allowedRoot: fixture.root });
  assert.equal(config.projectPath, await realpath(fixture.project));
  assert.equal(config.manager, 'npm');
  assert.equal(config.baselineVersion, '11.14.1');
});

test('rejects absolute and parent-traversal project or output paths', () => {
  const base = '/tmp/trusted/lockfile-matrix.json';
  const common = { schemaVersion: 1, manager: 'npm', baselineVersion: '1.0.0', candidateVersion: '2.0.0', nodeVersion: '20.10.0' };
  assert.throws(() => validateConfig({ ...common, projectPath: '../secret' }, base, { allowedRoot: '/tmp/trusted' }), UsageError);
  assert.throws(() => validateConfig({ ...common, outputDir: '/tmp/out' }, base, { allowedRoot: '/tmp/trusted' }), UsageError);
});

test('enforces the published pnpm security floor', () => {
  const base = '/tmp/trusted/lockfile-matrix.json';
  const common = { schemaVersion: 1, manager: 'pnpm', baselineVersion: '11.5.2', candidateVersion: '12.0.0-beta.0', nodeVersion: '24.16.0' };
  assert.throws(() => validateConfig(common, base, { allowedRoot: '/tmp/trusted' }), /security floor/);
  assert.throws(() => validateConfig({ ...common, baselineVersion: '11.5.3-alpha.0' }, base, { allowedRoot: '/tmp/trusted' }), /security floor/);
  assert.throws(() => validateConfig({ ...common, baselineVersion: '10.34.2-beta.0' }, base, { allowedRoot: '/tmp/trusted' }), /security floor/);
  assert.doesNotThrow(() => validateConfig({ ...common, baselineVersion: '11.5.3' }, base, { allowedRoot: '/tmp/trusted' }));
});

test('rejects a source symlink and executable pnpm hook', async (t) => {
  const fixture = await createNpmFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await writeFile(path.join(fixture.project, '.pnpmfile.cjs'), 'throw new Error("must not execute")');
  await symlink('package.json', path.join(fixture.project, 'linked-package.json'));
  const config = await loadConfig(fixture.configPath, { allowedRoot: fixture.root });
  await assert.rejects(preflight(config), (error) => error instanceof BoundaryError && error.details.some((detail) => detail.includes('pnpm hooks')) && error.details.some((detail) => detail.includes('symlinks')));
});

test('rejects repository npmrc and credential-bearing lock URLs without echoing secrets', async (t) => {
  const fixture = await createNpmFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await writeFile(path.join(fixture.project, '.npmrc'), '//registry.npmjs.org/:_authToken=super-secret-value');
  const lock = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(fixture.project, 'package-lock.json'), 'utf8'));
  lock.packages['node_modules/x'] = { version: '1.0.0', resolved: 'https://user:super-secret-value@registry.npmjs.org/x/-/x-1.0.0.tgz?token=super-secret-value' };
  await writeFile(path.join(fixture.project, 'package-lock.json'), JSON.stringify(lock));
  const config = await loadConfig(fixture.configPath, { allowedRoot: fixture.root });
  await assert.rejects(preflight(config), (error) => {
    assert.ok(error instanceof BoundaryError);
    assert.equal(JSON.stringify(error).includes('super-secret-value'), false);
    assert.equal(error.details.join('\n').includes('super-secret-value'), false);
    return true;
  });
});

test('rejects nested override remote specs and local dependency escapes', async (t) => {
  const fixture = await createNpmFixture({ overrides: { alpha: { beta: 'git+https://example.com/private.git' } }, dependencies: { outside: 'file:../../secret' } });
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const config = await loadConfig(fixture.configPath, { allowedRoot: fixture.root });
  await assert.rejects(preflight(config), (error) => error instanceof BoundaryError
    && error.details.some((detail) => detail.includes('remote non-registry'))
    && error.details.some((detail) => detail.includes('local dependency path outside')));
});

test('rejects an output directory symlink that resolves outside the trusted root', async (t) => {
  const fixture = await createNpmFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const outside = path.join(fixture.root, '..', `outside-${Date.now()}`);
  await mkdir(outside, { recursive: true });
  t.after(() => rm(outside, { recursive: true, force: true }));
  await symlink(outside, path.join(fixture.root, 'results'));
  await assert.rejects(loadConfig(fixture.configPath, { allowedRoot: fixture.root }), UsageError);
});

test('parses escaped npm lock URLs and rejects a higher-priority dual shrinkwrap', async (t) => {
  const fixture = await createNpmFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const malicious = '{"name":"x","version":"1.0.0","lockfileVersion":3,"packages":{"":{"name":"x","version":"1.0.0"},"node_modules/x":{"resolved":"https:\\/\\/evil.example\\/x.tgz"}}}';
  await writeFile(path.join(fixture.project, 'package-lock.json'), malicious);
  await writeFile(path.join(fixture.project, 'npm-shrinkwrap.json'), malicious);
  const config = await loadConfig(fixture.configPath, { allowedRoot: fixture.root });
  await assert.rejects(preflight(config), (error) => error instanceof BoundaryError
    && error.details.some((detail) => detail.includes('both package-lock.json and npm-shrinkwrap.json'))
    && error.details.some((detail) => detail.includes('public HTTPS boundary')));
});

test('accepts shrinkwrap-only npm input and records the actual npm-priority lockfile', async (t) => {
  const fixture = await createNpmFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await (await import('node:fs/promises')).rename(path.join(fixture.project, 'package-lock.json'), path.join(fixture.project, 'npm-shrinkwrap.json'));
  const config = await loadConfig(fixture.configPath, { allowedRoot: fixture.root });
  assert.equal((await preflight(config)).lockfile, 'npm-shrinkwrap.json');
});

test('rejects pnpm configDependencies, package-manager lock metadata, and workspace registry routing', async (t) => {
  const fixture = await createNpmFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const configJson = JSON.parse(await (await import('node:fs/promises')).readFile(fixture.configPath, 'utf8'));
  configJson.manager = 'pnpm';
  configJson.baselineVersion = '11.17.0';
  configJson.candidateVersion = '12.0.0-beta.0';
  await writeFile(fixture.configPath, JSON.stringify(configJson));
  await rm(path.join(fixture.project, 'package-lock.json'));
  await writeFile(path.join(fixture.project, 'pnpm-workspace.yaml'), 'packages:\n  - .\nconfigDependencies:\n  pacquet: 0.2.2\nregistries:\n  private: https://evil.example/\n');
  await writeFile(path.join(fixture.project, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\nimporters:\n  .:\n    packageManagerDependencies:\n      pnpm:\n        specifier: 9.3.0\n        version: 9.3.0\n");
  const config = await loadConfig(fixture.configPath, { allowedRoot: fixture.root });
  await assert.rejects(preflight(config), (error) => error instanceof BoundaryError
    && error.details.some((detail) => detail.includes('configDependencies'))
    && error.details.some((detail) => detail.includes('registries'))
    && error.details.some((detail) => detail.includes('packageManagerDependencies')));
});

test('rejects a package-lock link target that escapes the project root', async (t) => {
  const fixture = await createNpmFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const lock = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(fixture.project, 'package-lock.json'), 'utf8'));
  lock.packages['node_modules/x'] = { link: true, resolved: '../../outside' };
  await writeFile(path.join(fixture.project, 'package-lock.json'), JSON.stringify(lock));
  const config = await loadConfig(fixture.configPath, { allowedRoot: fixture.root });
  await assert.rejects(preflight(config), (error) => error instanceof BoundaryError && error.details.some((detail) => detail.includes('local dependency path outside')));
});

test('rejects duplicate pnpm YAML keys instead of choosing a parser-dependent winner', async (t) => {
  const fixture = await createNpmFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const configJson = JSON.parse(await (await import('node:fs/promises')).readFile(fixture.configPath, 'utf8'));
  configJson.manager = 'pnpm';
  configJson.baselineVersion = '11.17.0';
  configJson.candidateVersion = '12.0.0-beta.0';
  await writeFile(fixture.configPath, JSON.stringify(configJson));
  await rm(path.join(fixture.project, 'package-lock.json'));
  await writeFile(path.join(fixture.project, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\nimporters: {}\nimporters:\n  .: {}\n");
  const config = await loadConfig(fixture.configPath, { allowedRoot: fixture.root });
  await assert.rejects(preflight(config), (error) => error instanceof BoundaryError && error.details.some((detail) => detail.includes('not valid YAML')));
});
