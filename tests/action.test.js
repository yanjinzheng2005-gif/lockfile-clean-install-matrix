import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { runAction } from '../src/action.js';
import { createNpmFixture, FakeDockerRunner } from './helpers.js';

test('Action writes bounded outputs and a step summary', async (t) => {
  const fixture = await createNpmFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const outputFile = path.join(fixture.root, 'github-output.txt');
  const summaryFile = path.join(fixture.root, 'github-summary.md');
  const env = {
    GITHUB_WORKSPACE: fixture.root,
    GITHUB_OUTPUT: outputFile,
    GITHUB_STEP_SUMMARY: summaryFile,
    INPUT_CONFIG: fixture.configPath,
    'INPUT_FAIL-ON': 'review',
  };
  const exitCode = await runAction({ env, runner: new FakeDockerRunner('pass') });
  assert.equal(exitCode, 0);
  const outputs = await readFile(outputFile, 'utf8');
  assert.ok(outputs.includes('verdict'));
  assert.ok(outputs.includes('NO_REGRESSION'));
  const summary = await readFile(summaryFile, 'utf8');
  assert.ok(summary.includes('Lockfile Clean Install Matrix'));
  assert.ok(summary.includes('Raw diagnostic logs are intentionally omitted'));
  assert.equal(summary.includes('ghp_abcdefghijklmnopqrstuvwxyz'), false);
});

test('Action defaults to fail closed on an inconclusive result', async (t) => {
  const fixture = await createNpmFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const env = {
    GITHUB_WORKSPACE: fixture.root,
    GITHUB_OUTPUT: path.join(fixture.root, 'github-output.txt'),
    GITHUB_STEP_SUMMARY: path.join(fixture.root, 'github-summary.md'),
    INPUT_CONFIG: fixture.configPath,
  };
  assert.equal(await runAction({ env, runner: new FakeDockerRunner('network') }), 1);
});
