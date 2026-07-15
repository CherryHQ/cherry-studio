import { createRequire } from 'node:module'
import { Worker } from 'node:worker_threads'

import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import PQueue from 'p-queue'

import { readableContentWorkerSource } from './readableContentWorkerSource'

const logger = loggerService.withContext('ReadableContentService')

const SAFE_JSDOM_URL = 'http://localhost/'
const DEFAULT_PARSE_TIMEOUT_MS = 10_000
const moduleRequire = createRequire(import.meta.url)
const JSDOM_MODULE_PATH = moduleRequire.resolve('jsdom')
const READABILITY_MODULE_PATH = moduleRequire.resolve('@mozilla/readability')
const TURNDOWN_MODULE_PATH = moduleRequire.resolve('turndown')

type ReadableContentWorkerInput = {
  readonly format: 'markdown' | 'preview'
  readonly inputKind: 'html' | 'text'
  readonly maxLength?: number
  readonly source: string
}

type ReadableContentWorkerMessage =
  | { type: 'result'; title: string; content: string }
  | { type: 'error'; message: string }

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

function createAbortError(message: string): Error {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

function createTimeoutError(timeoutMs: number): Error {
  const error = new Error(`Readable content extraction timed out after ${timeoutMs}ms`)
  error.name = 'TimeoutError'
  return error
}

@Injectable('ReadableContentService')
@ServicePhase(Phase.WhenReady)
export class ReadableContentService extends BaseService {
  private readonly queue = new PQueue({ concurrency: 3 })
  private readonly taskControllers = new Set<AbortController>()
  private readonly terminationPromises = new Set<Promise<void>>()
  private acceptingTasks = false
  private shutdownController: AbortController | null = null
  private teardownPromise: Promise<void> | null = null

  protected onInit(): void {
    this.acceptingTasks = true
    this.shutdownController = new AbortController()
    this.teardownPromise = null
  }

  protected onStop(): Promise<void> {
    return this.teardown('Readable content service is stopping')
  }

  protected onDestroy(): Promise<void> {
    return this.teardown('Readable content service is being destroyed')
  }

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
    const shutdownSignal = this.shutdownController?.signal
    if (!this.acceptingTasks || !shutdownSignal || shutdownSignal.aborted) {
      throw new Error('ReadableContentService is not initialized')
    }
    if (options.signal?.aborted) {
      throw getAbortReason(options.signal)
    }

    const taskController = new AbortController()
    const handleCallerAbort = (): void => taskController.abort(getAbortReason(options.signal!))
    const cleanupTask = (): void => {
      options.signal?.removeEventListener('abort', handleCallerAbort)
      this.taskControllers.delete(taskController)
    }

    this.taskControllers.add(taskController)
    options.signal?.addEventListener('abort', handleCallerAbort, { once: true })

    try {
      const queuedTask = this.queue.add(async () => {
        try {
          return await this.runWorker(input, taskController.signal, options.timeoutMs)
        } finally {
          cleanupTask()
        }
      })
      const result = await this.waitForQueueTask(queuedTask, taskController.signal)
      if (!result) {
        throw new Error('Readable content extraction task did not return a result')
      }
      return result
    } catch (error) {
      if (taskController.signal.aborted) {
        throw getAbortReason(taskController.signal)
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
      const worker = new Worker(readableContentWorkerSource, {
        eval: true,
        workerData: {
          baseUrl: SAFE_JSDOM_URL,
          ...input,
          jsdomModulePath: JSDOM_MODULE_PATH,
          readabilityModulePath: READABILITY_MODULE_PATH,
          turndownModulePath: TURNDOWN_MODULE_PATH
        }
      })
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
        this.trackTermination(worker)
        callback()
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

  private trackTermination(worker: Worker): void {
    const termination = worker.terminate().then(
      () => undefined,
      (error) => {
        logger.warn('Failed to terminate readable content worker', error as Error)
      }
    )

    this.terminationPromises.add(termination)
    void termination.finally(() => {
      this.terminationPromises.delete(termination)
    })
  }

  private teardown(reason: string): Promise<void> {
    if (this.teardownPromise) {
      return this.teardownPromise
    }

    this.acceptingTasks = false
    const shutdownController = this.shutdownController
    const abortError = createAbortError(reason)
    shutdownController?.abort(abortError)
    for (const taskController of this.taskControllers) {
      taskController.abort(abortError)
    }
    this.teardownPromise = this.finishTeardown(shutdownController)
    return this.teardownPromise
  }

  private async finishTeardown(shutdownController: AbortController | null): Promise<void> {
    await this.queue.onIdle()
    await Promise.all(this.terminationPromises)

    if (this.shutdownController === shutdownController) {
      this.shutdownController = null
    }
  }
}
