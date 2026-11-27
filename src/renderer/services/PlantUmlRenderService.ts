import PQueue from 'p-queue'

import type { PlantUmlRenderResponse } from '@renderer/workers/plantUml.worker'

const queue = new PQueue({ concurrency: 1 })
let worker: Worker | undefined

export function renderPlantUml(source: string, signal: AbortSignal): Promise<PlantUmlRenderResponse> {
  return queue.add(
    () =>
      new Promise((resolve, reject) => {
        signal.throwIfAborted()
        const activeWorker = (worker ??= new Worker(new URL('../workers/plantUml.worker.ts', import.meta.url), {
          type: 'module'
        }))
        const clear = () => {
          clearTimeout(timeout)
          signal.removeEventListener('abort', abort)
          activeWorker.onmessage = null
          activeWorker.onerror = null
        }
        const stop = (error: unknown) => {
          clear()
          activeWorker.terminate()
          worker = undefined
          reject(error)
        }
        const abort = () => stop(signal.reason)
        const timeout = setTimeout(() => stop(new DOMException('PlantUML rendering timed out', 'TimeoutError')), 10_000)

        signal.addEventListener('abort', abort, { once: true })
        activeWorker.onmessage = ({ data }: MessageEvent<PlantUmlRenderResponse>) => {
          clear()
          resolve(data)
        }
        activeWorker.onerror = (event) => {
          event.preventDefault()
          stop(new Error(event.message))
        }
        activeWorker.postMessage(source)
      }),
    { signal, throwOnTimeout: true }
  )
}
