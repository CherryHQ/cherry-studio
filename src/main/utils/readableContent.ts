import { createRequire } from 'node:module'
import { Worker } from 'node:worker_threads'

import { loggerService } from '@logger'

import { readableContentWorkerSource } from './readableContentWorkerSource'

const logger = loggerService.withContext('ReadableContent')

const SAFE_JSDOM_URL = 'http://localhost/'
const DEFAULT_PARSE_TIMEOUT_MS = 10_000
const moduleRequire = createRequire(import.meta.url)
const JSDOM_MODULE_PATH = moduleRequire.resolve('jsdom')
const READABILITY_MODULE_PATH = moduleRequire.resolve('@mozilla/readability')
const TURNDOWN_MODULE_PATH = moduleRequire.resolve('turndown')

type ReadableContentFormat = 'text' | 'markdown'

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

function terminateWorker(worker: Worker): void {
  void worker.terminate().catch((error) => {
    logger.warn('Failed to terminate readable content worker', error as Error)
  })
}

function runReadableContentWorker(
  html: string,
  format: ReadableContentFormat,
  options: ReadableContentOptions
): Promise<ReadableContentResult> {
  if (options.signal?.aborted) {
    return Promise.reject(getAbortReason(options.signal))
  }

  return new Promise((resolve, reject) => {
    const worker = new Worker(readableContentWorkerSource, {
      eval: true,
      workerData: {
        baseUrl: SAFE_JSDOM_URL,
        format,
        html,
        jsdomModulePath: JSDOM_MODULE_PATH,
        readabilityModulePath: READABILITY_MODULE_PATH,
        turndownModulePath: TURNDOWN_MODULE_PATH
      }
    })
    const timeoutMs = options.timeoutMs ?? DEFAULT_PARSE_TIMEOUT_MS
    let settled = false

    const cleanup = (): void => {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', handleAbort)
      worker.removeAllListeners()
    }

    const finish = (callback: () => void, shouldTerminate = true): void => {
      if (settled) return
      settled = true
      cleanup()
      if (shouldTerminate) {
        terminateWorker(worker)
      }
      callback()
    }

    const handleAbort = (): void => {
      finish(() => reject(getAbortReason(options.signal!)))
    }

    const timeout = setTimeout(() => {
      finish(() => reject(createTimeoutError(timeoutMs)))
    }, timeoutMs)

    timeout.unref()
    worker.unref()
    worker.once('message', (message: ReadableContentWorkerMessage) => {
      finish(() => {
        if (message.type === 'result') {
          resolve({ title: message.title, content: message.content })
        } else {
          reject(new Error(message.message))
        }
      })
    })
    worker.once('error', (error) => finish(() => reject(error)))
    worker.once('exit', (code) => {
      finish(() => reject(new Error(`Readable content worker exited before responding (code ${code})`)), false)
    })
    options.signal?.addEventListener('abort', handleAbort, { once: true })
  })
}

export async function extractReadableText(html: string, options: ReadableContentOptions = {}): Promise<string> {
  const result = await runReadableContentWorker(html, 'text', options)
  return result.content
}

export function extractReadableMarkdown(
  html: string,
  options: ReadableContentOptions = {}
): Promise<ReadableContentResult> {
  return runReadableContentWorker(html, 'markdown', options)
}
