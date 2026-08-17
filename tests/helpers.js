import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DockerRunner } from '../src/docker.js';

export async function createNpmFixture(options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'lockfile-matrix-test-'));
  const project = path.join(root, 'project');
  await mkdir(project, { recursive: true });
  const packageJson = {
    name: 'matrix-fixture',
    version: '1.0.0',
    private: true,
    scripts: options.scripts ?? {},
    dependencies: options.dependencies ?? {},
    overrides: options.overrides ?? {},
  };
  const lock = {
    name: 'matrix-fixture',
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        name: 'matrix-fixture',
        version: '1.0.0',
        dependencies: options.dependencies ?? {},
      },
    },
  };
  await writeFile(path.join(project, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);
  await writeFile(path.join(project, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
  const config = {
    schemaVersion: 1,
    projectPath: 'project',
    manager: 'npm',
    baselineVersion: '11.14.1',
    candidateVersion: '11.16.0',
    nodeVersion: '24.16.0',
    timeoutSeconds: 30,
    outputDir: 'results',
  };
  const configPath = path.join(root, 'lockfile-matrix.json');
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return { root, project, configPath };
}

export class FakeDockerRunner extends DockerRunner {
  constructor(scenario = 'pass') {
    super();
    this.scenario = scenario;
  }

  async prepare() {
    return {
      reference: 'node:24.16.0-bookworm-slim',
      id: 'sha256:fixture',
      repoDigest: 'node@sha256:fixture',
      platform: 'linux/amd64',
      dockerVersion: 'fixture',
      containerUser: '1000:1000',
    };
  }

  async runLeg(options) {
    for (const relative of ['.gitconfig', '.docker/config.json', '.DS_Store']) {
      try {
        await access(path.join(options.projectDir, relative));
        throw new Error(`Sensitive or omitted file reached isolated copy: ${relative}`);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Sensitive or omitted')) throw error;
      }
    }
    const managerResult = processResult({ stdout: `${options.version}\n` });
    const isCandidate = options.label === 'candidate';
    if (isCandidate && this.scenario === 'regression') {
      return { managerObserved: options.version, managerResult, installResult: processResult({ exitCode: 1, stderr: 'npm error EUSAGE lockfile mismatch' }), inventoryResult: null };
    }
    if (isCandidate && this.scenario === 'network') {
      return { managerObserved: options.version, managerResult, installResult: processResult({ exitCode: 1, stderr: 'npm error ENOTFOUND registry.npmjs.org' }), inventoryResult: null };
    }
    if (isCandidate && this.scenario === 'network-404') {
      return { managerObserved: options.version, managerResult, installResult: processResult({ exitCode: 1, stderr: 'ERR_PNPM_FETCH_404 package does not exist' }), inventoryResult: null };
    }
    if (isCandidate && this.scenario === 'network-500') {
      return { managerObserved: options.version, managerResult, installResult: processResult({ exitCode: 1, stderr: 'ERR_PNPM_FETCH_500 registry unavailable' }), inventoryResult: null };
    }
    if (isCandidate && this.scenario === 'hang') {
      return { managerObserved: options.version, managerResult, installResult: processResult({ exitCode: null, timedOut: true, stderr: 'timed out' }), inventoryResult: null };
    }
    if (isCandidate && this.scenario === 'mutation') {
      await writeFile(path.join(options.projectDir, 'package-lock.json'), '{"mutated":true}\n');
    }
    await mkdir(path.join(options.projectDir, 'node_modules', '.bin'), { recursive: true });
    await writeFile(path.join(options.projectDir, 'node_modules', '.bin', 'fixture-bin'), 'fixture');
    const inventory = {
      name: 'matrix-fixture',
      version: '1.0.0',
      dependencies: {
        alpha: { name: 'alpha', version: isCandidate && this.scenario === 'tree-change' ? '2.0.0' : '1.0.0' },
      },
    };
    const inventoryResult = processResult({
      stdout: JSON.stringify(inventory),
      outputTruncated: isCandidate && this.scenario === 'inventory-truncated',
      exitCode: isCandidate && this.scenario === 'inventory-exit' ? 1 : 0,
    });
    return {
      managerObserved: options.version,
      managerResult,
      installResult: processResult({ stdout: `ghp_abcdefghijklmnopqrstuvwxyz\n::error:: fake\n${options.projectDir}` }),
      inventoryResult,
    };
  }

  async dispose() {}
}

export function processResult(overrides = {}) {
  return {
    exitCode: 0,
    stdout: '',
    stderr: '',
    timedOut: false,
    outputTruncated: false,
    cleanupError: null,
    durationMs: 12,
    ...overrides,
  };
}
