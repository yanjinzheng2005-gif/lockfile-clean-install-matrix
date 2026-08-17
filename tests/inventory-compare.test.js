import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInventory, parseJsonOutput } from '../src/inventory.js';
import { compareLegs, shouldFail } from '../src/compare.js';

test('normalizes npm inventory deterministically while preserving ancestry', () => {
  const first = normalizeInventory('npm', JSON.stringify({ name: 'root', dependencies: { beta: { version: '2.0.0' }, alpha: { version: '1.0.0', dependencies: { beta: { version: '1.5.0' } } } } }));
  const second = normalizeInventory('npm', JSON.stringify({ dependencies: { alpha: { dependencies: { beta: { version: '1.5.0' } }, version: '1.0.0' }, beta: { version: '2.0.0' } }, name: 'root' }));
  assert.equal(first.digest, second.digest);
  assert.equal(first.rows.filter((row) => row.name === 'beta').length, 2);
  assert.notEqual(first.rows.filter((row) => row.name === 'beta')[0].ancestry, first.rows.filter((row) => row.name === 'beta')[1].ancestry);
});

test('rejects warning text or a decoy JSON object around inventory JSON', () => {
  assert.throws(() => parseJsonOutput('warning before\n{"name":"root"}\nwarning after'), /exactly one valid JSON/);
  assert.throws(() => parseJsonOutput('warning {"name":"fake-warning"}\n{"name":"root","dependencies":{"real":{"version":"1.0.0"}}}'), /exactly one valid JSON/);
});

test('normalizes a non-empty recursive pnpm inventory and detects a version change', () => {
  const baseline = normalizeInventory('pnpm', JSON.stringify([
    { name: 'root', dependencies: { 'is-number': { name: 'is-number', version: '7.0.0' } } },
    { name: 'workspace-a', dependencies: { alpha: { name: 'alpha', version: '1.0.0' } } },
  ]));
  const same = normalizeInventory('pnpm', JSON.stringify([
    { dependencies: { alpha: { version: '1.0.0', name: 'alpha' } }, name: 'workspace-a' },
    { dependencies: { 'is-number': { version: '7.0.0', name: 'is-number' } }, name: 'root' },
  ]));
  const changed = normalizeInventory('pnpm', JSON.stringify([
    { name: 'root', dependencies: { 'is-number': { name: 'is-number', version: '8.0.0' } } },
    { name: 'workspace-a', dependencies: { alpha: { name: 'alpha', version: '1.0.0' } } },
  ]));
  assert.equal(baseline.rows.length, 2);
  assert.equal(baseline.digest, same.digest);
  assert.notEqual(baseline.digest, changed.digest);
});

test('classifies equal pass legs as no regression and a tree change as review', () => {
  const leg = (digest, version) => ({ label: 'baseline', requestedVersion: version, observedVersion: version, status: 'PASS', installExitCode: 0, installDurationMs: 1, outputTruncated: false, installLog: '', mutations: [], inventory: { rows: [{ name: 'x', version: digest }], digest }, binShims: [], warnings: [] });
  assert.equal(compareLegs(leg('same', '1.0.0'), { ...leg('same', '2.0.0'), label: 'candidate' }).verdict, 'NO_REGRESSION');
  assert.equal(compareLegs(leg('one', '1.0.0'), { ...leg('two', '2.0.0'), label: 'candidate' }).verdict, 'REVIEW');
});

test('classifies a passing baseline and failed candidate as regression', () => {
  const baseline = { label: 'baseline', requestedVersion: '1.0.0', observedVersion: '1.0.0', status: 'PASS', installExitCode: 0, installDurationMs: 1, outputTruncated: false, installLog: '', mutations: [], inventory: { rows: [], digest: 'a' }, binShims: [], warnings: [] };
  const candidate = { ...baseline, label: 'candidate', requestedVersion: '2.0.0', observedVersion: '2.0.0', status: 'INSTALL_FAILED', installExitCode: 1, inventory: null };
  assert.equal(compareLegs(baseline, candidate).verdict, 'REGRESSION');
  assert.equal(shouldFail('REGRESSION', 'regression'), true);
  assert.equal(shouldFail('REVIEW', 'regression'), false);
  assert.equal(shouldFail('INCONCLUSIVE', 'review'), true);
  assert.equal(shouldFail('REGRESSION', 'never'), false);
});
