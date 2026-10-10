import type { Worker } from 'node:worker_threads'

import { AgentSessionForkError } from './checkpoint'

export async function runForkWorker(worker: Worker, signal: AbortSignal): Promise<unknown> {
  try {
    signal.throwIfAborted()
    return await new Promise<unknown>((resolve, reject) => {
      const onAbort = () => reject(signal.reason)
      const timer = setTimeout(() => reject(new Error('Fork worker timed out')), 60_000)
      const cleanup = () => {
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
      }
      signal.addEventListener('abort', onAbort, { once: true })
      worker.once('message', (message: { result: unknown; error?: string }) => {
        cleanup()
        if (message.error) reject(new AgentSessionForkError(message.error))
        else resolve(message.result)
      })
      worker.once('error', (error) => {
        cleanup()
        reject(error)
      })
      worker.once('exit', () => {
        cleanup()
        reject(new Error('Fork worker exited without a result'))
      })
      if (signal.aborted) onAbort()
    })
  } finally {
    // Await termination before the operation owner removes any staged files.
    await worker.terminate()
  }
}
