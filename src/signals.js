/** @param {{interrupt:()=>Promise<void>}} runner */
export function installInterruptionHandlers(runner) {
  let interrupted = false;
  /** @type {Array<[NodeJS.Signals,()=>void]>} */
  const entries = [];
  for (const signal of /** @type {NodeJS.Signals[]} */ (['SIGINT', 'SIGTERM'])) {
    const handler = () => {
      interrupted = true;
      void runner.interrupt().catch((error) => {
        process.stderr.write(`Signal cleanup failed: ${error instanceof Error ? error.message : String(error)}\n`);
      });
    };
    process.once(signal, handler);
    entries.push([signal, handler]);
  }
  return {
    get interrupted() { return interrupted; },
    remove() {
      for (const [signal, handler] of entries) process.removeListener(signal, handler);
    },
  };
}
