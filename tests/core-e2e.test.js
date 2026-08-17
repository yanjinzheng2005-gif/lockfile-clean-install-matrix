import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { runMatrix } from '../src/core.js';
import { createNpmFixture, FakeDockerRunner } from './helpers.js';
import Ajv2020 from 'ajv/dist/2020.js';

test('writes matching JSON and Markdown receipts for a no-regression matrix', async (t) => {
  const fixture = await createNpmFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await writeFile(path.join(fixture.project, '.DS_Store'), 'finder metadata');
  await writeFile(path.join(fixture.project, '.gitconfig'), 'credential.helper=unsafe');
  await mkdir(path.join(fixture.project, '.docker'), { recursive: true });
  await writeFile(path.join(fixture.project, '.docker', 'config.json'), '{"auths":{"example":{"auth":"secret"}}}');
  const config = await loadConfig(fixture.configPath, { allowedRoot: fixture.root });
  const result = await runMatrix(config, { runner: new FakeDockerRunner('pass'), now: () => new Date('2026-08-17T12:00:00Z') });
  assert.equal(result.verdict, 'NO_REGRESSION');
  const json = await readFile(result.jsonPath, 'utf8');
  const markdown = await readFile(result.markdownPath, 'utf8');
  const parsed = JSON.parse(json);
  assert.equal(parsed.comparison.verdict, 'NO_REGRESSION');
  assert.ok(markdown.includes('NO_REGRESSION'));
  assert.equal(json.includes('ghp_abcdefghijklmnopqrstuvwxyz'), false);
  assert.equal(markdown.includes('ghp_abcdefghijklmnopqrstuvwxyz'), false);
  assert.equal(json.includes('::error::'), false);
  assert.equal(parsed.sourceUnchanged, true);
  const receiptSchema = JSON.parse(await readFile(new URL('../schema/receipt.schema.json', import.meta.url), 'utf8'));
  const validate = new Ajv2020({ strict: false, validateFormats: false }).compile(receiptSchema);
  assert.equal(validate(parsed), true, JSON.stringify(validate.errors));
  const configSchema = JSON.parse(await readFile(new URL('../schema/config.schema.json', import.meta.url), 'utf8'));
  const validateConfigSchema = new Ajv2020({ strict: false, validateFormats: false }).compile(configSchema);
  const rawConfig = JSON.parse(await readFile(fixture.configPath, 'utf8'));
  assert.equal(validateConfigSchema(rawConfig), true, JSON.stringify(validateConfigSchema.errors));
  assert.equal(validateConfigSchema({ ...rawConfig, manager: 'pnpm', baselineVersion: '11.5.2', candidateVersion: '12.0.0-beta.0' }), false);
});

for (const [scenario, verdict, status] of [
  ['regression', 'REGRESSION', 'INSTALL_FAILED'],
  ['network', 'INCONCLUSIVE', 'NETWORK_INCONCLUSIVE'],
  ['network-404', 'REGRESSION', 'INSTALL_FAILED'],
  ['network-500', 'INCONCLUSIVE', 'NETWORK_INCONCLUSIVE'],
  ['hang', 'REGRESSION', 'HANG'],
  ['mutation', 'REGRESSION', 'MUTATED'],
  ['tree-change', 'REVIEW', 'PASS'],
  ['inventory-truncated', 'INCONCLUSIVE', 'INVENTORY_INCONCLUSIVE'],
  ['inventory-exit', 'INCONCLUSIVE', 'INVENTORY_INCONCLUSIVE'],
]) {
  test(`classifies ${scenario} without modifying the source project`, async (t) => {
    const fixture = await createNpmFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    const before = await readFile(`${fixture.project}/package-lock.json`, 'utf8');
    const config = await loadConfig(fixture.configPath, { allowedRoot: fixture.root });
    const result = await runMatrix(config, { runner: new FakeDockerRunner(scenario) });
    assert.equal(result.verdict, verdict);
    assert.equal(result.receipt.candidate.status, status);
    assert.equal(await readFile(`${fixture.project}/package-lock.json`, 'utf8'), before);
  });
}
