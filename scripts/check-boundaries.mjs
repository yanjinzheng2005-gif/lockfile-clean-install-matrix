import { readFile } from 'node:fs/promises';

const docker = await readFile('src/docker.js', 'utf8');
const preflight = await readFile('src/preflight.js', 'utf8');
const workspace = await readFile('src/workspace.js', 'utf8');
const policy = await readFile('src/policy.js', 'utf8');
const actionSource = await readFile('src/action.js', 'utf8');
const core = await readFile('src/core.js', 'utf8');
const workflow = await readFile('.github/workflows/ci.yml', 'utf8');
const action = await readFile('action.yml', 'utf8');
const packageJson = await readFile('package.json', 'utf8');
const combined = `${docker}\n${preflight}\n${workspace}\n${policy}\n${actionSource}\n${core}\n${workflow}\n${action}\n${packageJson}`;

for (const required of [
  '--ignore-scripts', '--config.ignore-pnpmfile=true', '--read-only', '--cap-drop', 'no-new-privileges:true',
  '--pids-limit', '--memory', '--cpus', 'NPM_CONFIG_IGNORE_SCRIPTS=true', 'persist-credentials: false',
  'permissions:', 'contents: read', 'parseAllDocuments', 'configdependencies', 'packagemanagerdependencies',
  'npm-shrinkwrap.json', 'bootstrap-npm', 'project-npm-cache', '--config.include-workspace-root=true',
  "replaceAll(' ', '_')", 'default: review', 'real-docker-boundary-probe.mjs', 'check-dist-committed.mjs',
  "from './policy.js'",
]) {
  if (!combined.includes(required)) throw new Error(`Required safety boundary is missing: ${required}`);
}
for (const forbidden of ['pull_request_target', '--privileged', '--network host', 'source=/var/run/docker.sock', 'target=/var/run/docker.sock', '--env-file', 'secrets.GITHUB_TOKEN', 'uniqueKeys: false', 'INPUT_FAIL_ON', 'default: regression']) {
  if (combined.includes(forbidden)) throw new Error(`Forbidden Action/container boundary found: ${forbidden}`);
}
if (/\.\.\.process\.env/.test(docker)) throw new Error('Docker execution must not inherit the complete parent environment.');
if (workflow.indexOf('Exercise the committed Action before any local build') > workflow.indexOf('Build committed entrypoints')) {
  throw new Error('The committed Action must run before any workflow build can overwrite dist/.');
}
for (const fixture of ['fixtures/npm-pass/package.json', 'fixtures/pnpm-pass/package.json', 'fixtures/npm-regression/package.json']) {
  const manifest = await readFile(fixture, 'utf8');
  if (!manifest.includes('fail-if-run.mjs')) throw new Error(`${fixture} lacks an active lifecycle-script sentinel.`);
}
console.log('Isolation, Action permission, and lifecycle-script boundary check: PASS');
