import { spawn } from 'node:child_process';

/**
 * @typedef {object} ProcessResult
 * @property {number|null} exitCode
 * @property {string} stdout
 * @property {string} stderr
 * @property {boolean} timedOut
 * @property {boolean} outputTruncated
 * @property {string|null} cleanupError
 * @property {number} durationMs
 */

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{cwd?:string,env?:NodeJS.ProcessEnv,timeoutMs?:number,maxOutputBytes?:number,onTimeout?:()=>Promise<void>|void,signal?:AbortSignal}} [options]
 * @returns {Promise<ProcessResult>}
 */
export function runProcess(command, args, options = {}) {
  const started = Date.now();
  const maxOutputBytes = options.maxOutputBytes ?? 512 * 1024;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      signal: options.signal,
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let outputTruncated = false;
    /** @param {Buffer} current @param {Buffer} chunk */
    const append = (current, chunk) => {
      const combined = Buffer.concat([current, Buffer.from(chunk)]);
      if (combined.length <= maxOutputBytes) return combined;
      outputTruncated = true;
      const half = Math.floor(maxOutputBytes / 2);
      return Buffer.concat([combined.subarray(0, half), Buffer.from('\n...[output truncated]...\n'), combined.subarray(combined.length - half)]);
    };
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });
    let timedOut = false;
    /** @type {Promise<void>} */
    let timeoutCleanup = Promise.resolve();
    /** @type {string|null} */
    let cleanupError = null;
    const timer = options.timeoutMs ? setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      timeoutCleanup = Promise.resolve(options.onTimeout?.()).catch((error) => {
        cleanupError = error instanceof Error ? error.message : String(error);
      }).finally(() => {
        child.kill('SIGKILL');
      });
    }, options.timeoutMs) : undefined;
    child.once('error', (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.once('close', async (exitCode) => {
      if (timer) clearTimeout(timer);
      await timeoutCleanup;
      resolve({
        exitCode,
        stdout: stdout.toString('utf8'),
        stderr: stderr.toString('utf8'),
        timedOut,
        outputTruncated,
        cleanupError,
        durationMs: Date.now() - started,
      });
    });
  });
}
