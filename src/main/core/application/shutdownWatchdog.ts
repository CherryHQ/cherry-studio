import { Worker } from 'node:worker_threads'

/** A worker can enforce the exit deadline even while the main event loop is blocked. */
export function startShutdownWatchdog(timeoutMs: number, onError: (error: Error) => void): () => void {
  const state = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))
  const worker = new Worker(
    `const { workerData } = require('node:worker_threads');
     const state = new Int32Array(workerData.state);
     if (Atomics.wait(state, 0, 0, workerData.timeoutMs) === 'timed-out' &&
         Atomics.compareExchange(state, 0, 0, 2) === 0) {
       process.kill(process.pid, 'SIGKILL');
     }`,
    { eval: true, workerData: { state: state.buffer, timeoutMs } }
  )
  worker.on('error', onError)
  worker.unref()
  return () => {
    Atomics.store(state, 0, 1)
    Atomics.notify(state, 0)
  }
}
