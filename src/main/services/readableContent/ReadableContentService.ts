import type { Worker } from 'node:worker_threads'

import { loggerService } from '@logger'
import PQueue from 'p-queue'

import type { ReadableContentWorkerInput, ReadableContentWorkerMessage } from './readableContentWorker'
// oxlint-disable-next-line import/default -- Electron Vite exposes ?nodeWorker imports as default worker factories.
import createReadableContentWorker from './readableContentWorker?nodeWorker'

const logger = loggerService.withContext('ReadableContentService')

const DEFAULT_PARSE_TIMEOUT_MS = 10_000

export type ReadableContentResult = {
  title: string
  content: string
}

export type ReadableContentOptions = {
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
}

export type PreviewTextOptions = ReadableContentOptions & {
  readonly inputKind: 'html' | 'text'
  readonly maxLength: number
}

function getAbortReason(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) {
    return signal.reason
  }

  return new DOMException('Readable content extraction aborted', 'AbortError')
}

function createTimeoutError(timeoutMs: number): Error {
  const error = new Error(`Readable content extraction timed out after ${timeoutMs}ms`)
  error.name = 'TimeoutError'
  return error
}

export class ReadableContentService {
  private readonly queue = new PQueue({ concurrency: 3 })

  extractReadableMarkdown(html: string, options: ReadableContentOptions = {}): Promise<ReadableContentResult> {
    return this.enqueue({ format: 'markdown', inputKind: 'html', source: html }, options)
  }

  async extractPreviewText(source: string, options: PreviewTextOptions): Promise<string> {
    const { inputKind, maxLength, ...workerOptions } = options
    const result = await this.enqueue({ format: 'preview', inputKind, maxLength, source }, workerOptions)
    return result.content
  }

  private async enqueue(
    input: ReadableContentWorkerInput,
    options: ReadableContentOptions
  ): Promise<ReadableContentResult> {
    const signal = options.signal ?? new AbortController().signal
    if (signal.aborted) {
      throw getAbortReason(signal)
    }

    try {
      const queuedTask = this.queue.add(() => this.runWorker(input, signal, options.timeoutMs))
      const result = await this.waitForQueueTask(queuedTask, signal)
      if (!result) {
        throw new Error('Readable content extraction task did not return a result')
      }
      return result
    } catch (error) {
      if (signal.aborted) {
        throw getAbortReason(signal)
      }
      throw error
    }
  }

  private waitForQueueTask<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) {
      return Promise.reject(getAbortReason(signal))
    }

    return new Promise((resolve, reject) => {
      let settled = false
      const cleanup = (): void => signal.removeEventListener('abort', handleAbort)
      const finish = (callback: () => void): void => {
        if (settled) return
        settled = true
        cleanup()
        callback()
      }
      const handleAbort = (): void => finish(() => reject(getAbortReason(signal)))

      signal.addEventListener('abort', handleAbort, { once: true })
      void task.then(
        (result) => finish(() => resolve(result)),
        (error) => finish(() => reject(error))
      )

      if (signal.aborted) {
        handleAbort()
      }
    })
  }

  private runWorker(
    input: ReadableContentWorkerInput,
    signal: AbortSignal,
    requestedTimeoutMs?: number
  ): Promise<ReadableContentResult> {
    if (signal.aborted) {
      return Promise.reject(getAbortReason(signal))
    }

    return new Promise((resolve, reject) => {
      const worker = createReadableContentWorker({ workerData: input })
      const timeoutMs = requestedTimeoutMs ?? DEFAULT_PARSE_TIMEOUT_MS
      let settled = false

      const cleanup = (): void => {
        clearTimeout(timeout)
        signal.removeEventListener('abort', handleAbort)
        worker.removeListener('message', handleMessage)
        worker.removeListener('error', handleError)
        worker.removeListener('exit', handleExit)
      }

      const finish = (callback: () => void): void => {
        if (settled) return
        settled = true
        cleanup()
        void this.terminateWorker(worker).then(callback)
      }

      const handleAbort = (): void => {
        finish(() => reject(getAbortReason(signal)))
      }
      const handleMessage = (message: ReadableContentWorkerMessage): void => {
        finish(() => {
          if (message.type === 'result') {
            resolve({ title: message.title, content: message.content })
          } else {
            reject(new Error(message.message))
          }
        })
      }
      const handleError = (error: Error): void => {
        finish(() => reject(error))
      }
      const handleExit = (code: number): void => {
        finish(() => reject(new Error(`Readable content worker exited before responding (code ${code})`)))
      }
      const timeout = setTimeout(() => {
        finish(() => reject(createTimeoutError(timeoutMs)))
      }, timeoutMs)

      timeout.unref()
      worker.unref()
      worker.once('message', handleMessage)
      worker.once('error', handleError)
      worker.once('exit', handleExit)
      signal.addEventListener('abort', handleAbort, { once: true })

      if (signal.aborted) {
        handleAbort()
      }
    })
  }

  private async terminateWorker(worker: Worker): Promise<void> {
    try {
      await worker.terminate()
    } catch (error) {
      logger.warn('Failed to terminate readable content worker', error as Error)
    }
  }
}

export const readableContentService = new ReadableContentService()
