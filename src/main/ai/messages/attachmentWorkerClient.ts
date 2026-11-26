import { loggerService } from '@logger'
import { PQueue } from '@shared/utils/async'

// oxlint-disable-next-line import/default -- Electron Vite provides the worker factory.
import createWorker from './attachmentWorker?nodeWorker'
import type { AttachmentWorkerMessage, AttachmentWorkerTasks } from './attachmentWorkerTypes'

const logger = loggerService.withContext('ai:attachmentWorker')
const queue = new PQueue({ concurrency: 2 })

export async function runAttachmentWorker<K extends keyof AttachmentWorkerTasks>(
  type: K,
  input: AttachmentWorkerTasks[K]['input'],
  signal?: AbortSignal
): Promise<AttachmentWorkerTasks[K]['result']> {
  signal?.throwIfAborted()
  const task = queue.add(
    async () => {
      signal?.throwIfAborted()
      const worker = createWorker({ workerData: { type, input } })
      try {
        return await new Promise<AttachmentWorkerTasks[K]['result']>((resolve, reject) => {
          const onAbort = () => {
            cleanup()
            reject(signal?.reason)
          }
          const timer = setTimeout(() => {
            cleanup()
            reject(new Error('Attachment worker timed out'))
          }, 60_000)
          const cleanup = () => {
            clearTimeout(timer)
            signal?.removeEventListener('abort', onAbort)
          }
          worker.on('message', (message: AttachmentWorkerMessage<AttachmentWorkerTasks[K]['result']>) => {
            if (message.type === 'log') {
              logger[message.level](message.message)
            } else {
              cleanup()
              resolve(message.value)
            }
          })
          worker.once('error', (error) => {
            cleanup()
            reject(error)
          })
          worker.once('exit', () => {
            cleanup()
            reject(new Error('Attachment worker exited without a result'))
          })
          signal?.addEventListener('abort', onAbort, { once: true })
          if (signal?.aborted) onAbort()
          timer.unref()
          worker.unref()
        })
      } finally {
        await worker.terminate()
      }
    },
    { throwOnTimeout: true }
  )
  if (!signal) return task
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    signal.addEventListener('abort', onAbort, { once: true })
    void task.then(
      (result) => {
        cleanup()
        resolve(result)
      },
      (error) => {
        cleanup()
        reject(error)
      }
    )
    if (signal.aborted) onAbort()
  })
}
