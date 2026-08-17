import { mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { EnvironmentError } from './errors.js';
import { runProcess } from './process.js';

/** @typedef {import('./process.js').ProcessResult} ProcessResult */

export class DockerRunner {
  /** @param {{command?:string,execute?:typeof runProcess}} [options] */
  constructor(options = {}) {
    this.command = options.command ?? 'docker';
    this.execute = options.execute ?? runProcess;
    /** @type {Set<string>} */
    this.activeContainers = new Set();
    /** @type {NodeJS.ProcessEnv|undefined} */
    this.hostEnv = undefined;
    this.image = '';
    this.imageReceipt = null;
    this.interrupted = false;
    this.abortController = new AbortController();
    this.uid = typeof process.getuid === 'function' ? process.getuid() : -1;
    this.gid = typeof process.getgid === 'function' ? process.getgid() : -1;
  }

  /** @param {{nodeVersion:string,runRoot:string}} options */
  async prepare(options) {
    this.assertNotInterrupted();
    if (this.uid <= 0 || this.gid < 0) {
      throw new EnvironmentError('V0.1 requires a non-root POSIX host user for the container mapping.');
    }
    const dockerHost = await discoverLocalDockerHost(this.execute, this.command);
    const dockerConfig = path.join(options.runRoot, 'docker-config');
    await mkdir(dockerConfig, { recursive: true, mode: 0o700 });
    this.hostEnv = dockerHostEnvironment(dockerConfig, dockerHost);

    const infoResult = await this.execDocker(['info', '--format', '{{json .}}'], 15000);
    this.assertNotInterrupted();
    if (infoResult.exitCode !== 0 || infoResult.timedOut) {
      throw new EnvironmentError('Docker is unavailable or its daemon is not running.');
    }
    let info;
    try { info = JSON.parse(infoResult.stdout.trim()); } catch { throw new EnvironmentError('Docker returned unreadable engine information.'); }
    if (info.OSType !== 'linux') throw new EnvironmentError('V0.1 requires a Linux Docker engine.');

    const imageReference = `node:${options.nodeVersion}-bookworm-slim`;
    this.image = imageReference;
    const pull = await this.execDocker(['pull', '--platform', 'linux/amd64', imageReference], 300000);
    this.assertNotInterrupted();
    if (pull.exitCode !== 0 || pull.timedOut) {
      throw new EnvironmentError('Docker could not pull the exact Node image required by the config.');
    }
    const inspected = await this.execDocker(['image', 'inspect', imageReference, '--format', '{{json .}}'], 30000);
    this.assertNotInterrupted();
    if (inspected.exitCode !== 0 || inspected.timedOut) throw new EnvironmentError('Docker could not inspect the selected Node image.');
    let imageInfo;
    try { imageInfo = JSON.parse(inspected.stdout.trim()); } catch { throw new EnvironmentError('Docker returned unreadable image information.'); }
    const imageId = String(imageInfo.Id ?? '');
    if (!/^sha256:[a-f0-9]{64}$/i.test(imageId)) throw new EnvironmentError('Docker did not return a pinned image ID.');
    this.imageReceipt = {
      reference: imageReference,
      id: imageId,
      repoDigest: Array.isArray(imageInfo.RepoDigests) ? String(imageInfo.RepoDigests[0] ?? '') : '',
      platform: 'linux/amd64',
      dockerVersion: String(info.ServerVersion ?? ''),
      containerUser: `${this.uid}:${this.gid}`,
    };
    this.image = imageId;
    return this.imageReceipt;
  }

  /**
   * @param {{label:'baseline'|'candidate',manager:'npm'|'pnpm',version:string,registry:string,timeoutSeconds:number,projectDir:string,cacheDir:string,workspaceProject:boolean}} options
   */
  async runLeg(options) {
    this.assertNotInterrupted();
    if (!this.image || !this.hostEnv) throw new EnvironmentError('DockerRunner.prepare must complete before running a leg.');
    await mkdir(options.cacheDir, { recursive: true, mode: 0o700 });
    const versionResult = await this.runManagerPhase(options, 'version', 120000);
    this.assertNotInterrupted();
    const managerObserved = lastNonEmptyLine(versionResult.stdout);
    if (versionResult.exitCode !== 0 || versionResult.timedOut || managerObserved !== options.version) {
      return { managerObserved, managerResult: versionResult, installResult: null, inventoryResult: null };
    }
    const installResult = await this.runManagerPhase(options, 'install', options.timeoutSeconds * 1000);
    this.assertNotInterrupted();
    if (installResult.exitCode !== 0 || installResult.timedOut || installResult.cleanupError) {
      return { managerObserved, managerResult: versionResult, installResult, inventoryResult: null };
    }
    const inventoryResult = await this.runManagerPhase(options, 'inventory', Math.min(options.timeoutSeconds * 1000, 180000));
    this.assertNotInterrupted();
    return { managerObserved, managerResult: versionResult, installResult, inventoryResult };
  }

  /** @param {{label:string,manager:'npm'|'pnpm',version:string,registry:string,projectDir:string,cacheDir:string,workspaceProject:boolean}} options @param {'version'|'install'|'inventory'} phase @param {number} timeoutMs */
  async runManagerPhase(options, phase, timeoutMs) {
    this.assertNotInterrupted();
    const name = `lockfile-matrix-${options.label}-${phase}-${randomBytes(5).toString('hex')}`;
    const command = managerCommand(options.manager, options.version, phase, options.registry, { workspaceProject: options.workspaceProject });
    const args = buildDockerRunArgs({
      name,
      image: this.image,
      uid: this.uid,
      gid: this.gid,
      projectDir: options.projectDir,
      cacheDir: options.cacheDir,
      registry: options.registry,
      command,
    });
    this.activeContainers.add(name);
    const result = await this.execute(this.command, args, {
      env: this.hostEnv,
      timeoutMs,
      maxOutputBytes: phase === 'inventory' ? 16 * 1024 * 1024 : 512 * 1024,
      onTimeout: async () => this.forceRemove(name),
      signal: this.abortController.signal,
    });
    if (!result.timedOut) await this.confirmGone(name);
    if (result.cleanupError) throw new EnvironmentError(`Timed-out container cleanup failed: ${result.cleanupError}`);
    this.activeContainers.delete(name);
    return result;
  }

  /** @param {string} name */
  async forceRemove(name) {
    await this.execDocker(['rm', '--force', name], 15000, false);
    const inspect = await this.execDocker(['container', 'inspect', name], 10000, false);
    if (inspect.exitCode === 0) throw new Error(`Timed-out container ${name} still exists after forced removal.`);
    if (!isMissingContainer(inspect)) throw new Error(`Docker could not prove that container ${name} was removed.`);
    this.activeContainers.delete(name);
  }

  /** @param {string} name */
  async confirmGone(name) {
    const inspect = await this.execDocker(['container', 'inspect', name], 10000, false);
    if (inspect.exitCode === 0) {
      await this.forceRemove(name);
      throw new EnvironmentError('A supposedly removed matrix container was still present.');
    }
    if (!isMissingContainer(inspect)) throw new EnvironmentError('Docker could not confirm automatic container removal.');
  }

  async dispose() {
    const errors = [];
    for (const name of [...this.activeContainers]) {
      try { await this.forceRemove(name); } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
    }
    if (errors.length) throw new EnvironmentError(`Container cleanup failed: ${errors.join('; ')}`);
  }

  async interrupt() {
    this.interrupted = true;
    this.abortController.abort();
    await this.dispose();
  }

  assertNotInterrupted() {
    if (this.interrupted) throw new EnvironmentError('Matrix run interrupted by SIGINT or SIGTERM.');
  }

  /** @param {string[]} args @param {number} timeoutMs @param {boolean} [interruptible] @returns {Promise<ProcessResult>} */
  async execDocker(args, timeoutMs, interruptible = true) {
    return this.execute(this.command, args, {
      env: this.hostEnv,
      timeoutMs,
      maxOutputBytes: 128 * 1024,
      signal: interruptible ? this.abortController.signal : undefined,
    });
  }
}

/**
 * @param {{name:string,image:string,uid:number,gid:number,projectDir:string,cacheDir:string,registry:string,command:string[]}} options
 */
export function buildDockerRunArgs(options) {
  const environment = [
    'CI=true',
    'HOME=/tmp',
    'NO_COLOR=1',
    'FORCE_COLOR=0',
    'COREPACK_ENABLE_PROJECT_SPEC=0',
    'NPM_CONFIG_AUDIT=false',
    'NPM_CONFIG_FUND=false',
    'NPM_CONFIG_IGNORE_SCRIPTS=true',
    `NPM_CONFIG_REGISTRY=${options.registry}`,
    'NPM_CONFIG_UPDATE_NOTIFIER=false',
    'NPM_CONFIG_USERCONFIG=/tmp/empty-npmrc',
    'NPM_CONFIG_GLOBALCONFIG=/tmp/empty-global-npmrc',
    'NPM_CONFIG_CACHE=/matrix-cache/bootstrap-npm',
    'PNPM_HOME=/tmp/pnpm-home',
    'XDG_CACHE_HOME=/matrix-cache/xdg-cache',
    'XDG_CONFIG_HOME=/tmp/xdg-config',
    'GIT_CONFIG_NOSYSTEM=1',
    'GIT_CONFIG_GLOBAL=/tmp/empty-gitconfig',
  ];
  const args = [
    'run', '--rm', '--pull', 'never', '--name', options.name,
    '--platform', 'linux/amd64',
    '--user', `${options.uid}:${options.gid}`,
    '--read-only', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges:true',
    '--pids-limit', '256', '--memory', '2g', '--cpus', '2',
    '--network', 'bridge', '--ipc', 'none', '--init', '--stop-timeout', '2',
    '--tmpfs', '/tmp:rw,nosuid,nodev,size=1073741824',
    '--mount', `type=bind,source=${options.projectDir},target=/workspace`,
    '--mount', `type=bind,source=${options.cacheDir},target=/matrix-cache`,
    '--workdir', '/workspace',
    '--label', 'com.micro-tool-lab.lockfile-matrix=true',
  ];
  for (const value of environment) args.push('--env', value);
  args.push(options.image, ...options.command);
  return args;
}

/** @param {'npm'|'pnpm'} manager @param {string} version @param {'version'|'install'|'inventory'} phase @param {string} registry @param {{workspaceProject?:boolean}} [options] */
export function managerCommand(manager, version, phase, registry, options = {}) {
  const prefix = ['npx', '--yes', '--package', `${manager}@${version}`, '--', manager];
  if (manager === 'npm') {
    if (phase === 'version') return [...prefix, '--version'];
    if (phase === 'install') return [...prefix, 'ci', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', '/matrix-cache/project-npm-cache', '--registry', registry];
    return [...prefix, 'ls', '--all', '--json', '--long=false', '--cache', '/matrix-cache/project-npm-cache', ...(options.workspaceProject ? ['--workspaces', '--include-workspace-root'] : [])];
  }
  const safe = ['--config.manage-package-manager-versions=false', '--config.ignore-pnpmfile=true'];
  if (phase === 'version') return [...prefix, ...safe, '--version'];
  if (phase === 'install') {
    return [...prefix, ...safe, 'install', '--frozen-lockfile', '--ignore-scripts', '--store-dir', '/matrix-cache/pnpm-store', '--registry', registry, '--reporter', 'append-only'];
  }
  return [...prefix, ...safe, '--config.include-workspace-root=true', 'list', '--recursive', '--depth', 'Infinity', '--json'];
}

/** @param {string} dockerConfig @param {string} dockerHost */
function dockerHostEnvironment(dockerConfig, dockerHost) {
  /** @type {NodeJS.ProcessEnv} */
  const result = { PATH: process.env.PATH, DOCKER_CONFIG: dockerConfig, DOCKER_HOST: dockerHost };
  return result;
}

/** @param {typeof runProcess} execute @param {string} command */
async function discoverLocalDockerHost(execute, command) {
  if (process.env.DOCKER_HOST) {
    if (!process.env.DOCKER_HOST.startsWith('unix://')) throw new EnvironmentError('V0.1 does not use a remote Docker daemon.');
    return process.env.DOCKER_HOST;
  }
  /** @type {NodeJS.ProcessEnv} */
  const discoveryEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    DOCKER_CONFIG: process.env.DOCKER_CONFIG,
    DOCKER_CONTEXT: process.env.DOCKER_CONTEXT,
  };
  const context = await execute(command, ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], {
    env: discoveryEnv,
    timeoutMs: 10000,
    maxOutputBytes: 32768,
  }).catch(() => null);
  const endpoint = context && context.exitCode === 0 ? lastNonEmptyLine(context.stdout) : 'unix:///var/run/docker.sock';
  if (!endpoint.startsWith('unix://')) throw new EnvironmentError('The active Docker context is not a local Unix socket.');
  return endpoint;
}

/** @param {string} value */
function lastNonEmptyLine(value) {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1) ?? '';
}

/** @param {ProcessResult} result */
function isMissingContainer(result) {
  return result.exitCode !== 0
    && !result.timedOut
    && !result.cleanupError
    && /(?:No such (?:object|container)|container\s+[^\s]+\s+not found)/i.test(`${result.stdout}\n${result.stderr}`);
}
