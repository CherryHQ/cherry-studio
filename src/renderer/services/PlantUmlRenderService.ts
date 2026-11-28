import PQueue from 'p-queue'

import type { PlantUmlRenderResponse } from '@renderer/workers/plantUml.worker'

class PlantUmlRenderService {
  private readonly queue = new PQueue({ concurrency: 1 })
  private worker: Worker | undefined

  render(source: string, signal: AbortSignal): Promise<PlantUmlRenderResponse> {
    return this.queue.add(
      () =>
        new Promise((resolve, reject) => {
          signal.throwIfAborted()
          const activeWorker = (this.worker ??= new Worker(new URL('../workers/plantUml.worker.ts', import.meta.url), {
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
            this.worker = undefined
            reject(error)
          }
          const abort = () => stop(signal.reason)
          const timeout = setTimeout(
            () => stop(new DOMException('PlantUML rendering timed out', 'TimeoutError')),
            10_000
          )

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
}

export const plantUmlRenderService = new PlantUmlRenderService()
