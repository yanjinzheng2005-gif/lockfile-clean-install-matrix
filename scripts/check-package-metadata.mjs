import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const root = lock.packages?.[''];
assert.ok(root, 'package-lock.json is missing its root package metadata.');
for (const key of ['name', 'version', 'license', 'bin', 'engines', 'dependencies', 'devDependencies']) {
  assert.deepEqual(root[key] ?? {}, manifest[key] ?? {}, `package-lock root ${key} does not match package.json.`);
}
console.log('Package manifest/lock root metadata check: PASS');
