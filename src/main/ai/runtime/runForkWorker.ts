import { AgentSessionForkError } from './forkCheckpoint'
import type { ForkWorkerInput } from './forkWorker'
// oxlint-disable-next-line import/default -- Electron Vite supplies the worker factory.
import createForkWorker from './forkWorker?nodeWorker'

export async function runForkWorker<T>(input: ForkWorkerInput, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  const worker = createForkWorker({ workerData: input, env: { ...process.env } })
  try {
    return await new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(signal.reason)
      const timer = setTimeout(() => reject(new Error('Fork worker timed out')), 60_000)
      const cleanup = () => {
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
      }
      signal.addEventListener('abort', onAbort, { once: true })
      worker.once('message', (message: { result: T; error?: string }) => {
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
