import { loggerService } from '@logger'

import type { JsExecutionResult } from './workers/JsWorker'
// oxlint-disable-next-line default
import createJsWorker from './workers/JsWorker?nodeWorker'

interface ExecuteScriptOptions {
  timeout?: number
}

type WorkerResponse =
  | {
      success: true
      result: JsExecutionResult
    }
  | {
      success: false
      error: string
    }

const DEFAULT_TIMEOUT = 60_000

const logger = loggerService.withContext('JsService')

export class JsService {
  private static instance: JsService | null = null

  private constructor() {}

  public static getInstance(): JsService {
    if (!JsService.instance) {
      JsService.instance = new JsService()
    }
    return JsService.instance
  }

  public async executeScript(code: string, options: ExecuteScriptOptions = {}): Promise<JsExecutionResult> {
    const { timeout = DEFAULT_TIMEOUT } = options

    if (!code || typeof code !== 'string') {
      throw new Error('JavaScript code must be a non-empty string')
    }

    // Limit code size to 1MB to prevent memory issues
    const MAX_CODE_SIZE = 1_000_000
    if (code.length > MAX_CODE_SIZE) {
      throw new Error(`JavaScript code exceeds maximum size of ${MAX_CODE_SIZE / 1_000_000}MB`)
    }

    return new Promise<JsExecutionResult>((resolve, reject) => {
      const worker = createJsWorker({
        workerData: { code },
        argv: [],
        trackUnmanagedFds: false
      })

      let settled = false
      let timeoutId: NodeJS.Timeout | null = null

      const cleanup = async () => {
        if (timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = null
        }
        try {
          await worker.terminate()
        } catch {
          // ignore termination errors
        }
      }

      const settleSuccess = async (result: JsExecutionResult) => {
        if (settled) return
        settled = true
        await cleanup()
        resolve(result)
      }

      const settleError = async (error: Error) => {
        if (settled) return
        settled = true
        await cleanup()
        reject(error)
      }

      worker.once('message', async (message: WorkerResponse) => {
        if (message.success) {
          await settleSuccess(message.result)
        } else {
          await settleError(new Error(message.error))
        }
      })

      worker.once('error', async (error) => {
        logger.error(`JsWorker error: ${error instanceof Error ? error.message : String(error)}`)
        await settleError(error instanceof Error ? error : new Error(String(error)))
      })

      worker.once('exit', async (exitCode) => {
        if (!settled && exitCode !== 0) {
          await settleError(new Error(`JsWorker exited with code ${exitCode}`))
        }
      })

      timeoutId = setTimeout(() => {
        logger.warn(`JavaScript execution timed out after ${timeout}ms`)
        settleError(new Error('JavaScript execution timed out')).catch((err) => {
          logger.error('Error during timeout cleanup:', err instanceof Error ? err : new Error(String(err)))
        })
      }, timeout)
    })
  }
}

export const jsService = JsService.getInstance()
