import { Worker } from 'node:worker_threads'

import type { ToolExecutionOptions } from '@ai-sdk/provider-utils'
import { loggerService } from '@logger'

import type { ToolRegistry } from '../../registry'
import { execWorkerSource } from './worker'

const logger = loggerService.withContext('toolExec.runtime')

const MAX_LOGS = 1000
const EXECUTION_TIMEOUT_MS = 60_000

export interface ExecResult {
  result: unknown
  logs?: string[]
  error?: string
  isError?: boolean
}

export interface ExecRuntimeContext {
  registry: ToolRegistry
  parentOptions: ToolExecutionOptions
}

interface WorkerCallToolMessage {
  type: 'callTool'
  requestId: string
  name: string
  params: Record<string, unknown>
}

interface WorkerLogMessage {
  type: 'log'
  entry: string
}

interface WorkerResultMessage {
  type: 'result'
  result: unknown
  logs?: string[]
}

interface WorkerErrorMessage {
  type: 'error'
  error: string
  logs?: string[]
}

type WorkerMessage = WorkerCallToolMessage | WorkerLogMessage | WorkerResultMessage | WorkerErrorMessage

export function runExec(code: string, ctx: ExecRuntimeContext): Promise<ExecResult> {
  return new Promise<ExecResult>((resolve) => {
    const logs: string[] = []
    const activeChildAborts = new Set<AbortController>()
    let finished = false
    let timedOut = false
    const timeoutId: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      timedOut = true
      void (async () => {
        try {
          await worker.terminate()
        } catch (err) {
          logger.warn('failed to terminate exec worker after timeout', err as Error)
        }
        await finalize(
          {
            result: undefined,
            logs: logs.length > 0 ? logs : undefined,
            error: `tool_exec timed out after ${EXECUTION_TIMEOUT_MS}ms`,
            isError: true
          },
          false
        )
      })()
    }, EXECUTION_TIMEOUT_MS)
    const worker = new Worker(execWorkerSource, { eval: true })

    const addLog = (entry: string) => {
      if (logs.length < MAX_LOGS) logs.push(entry)
    }

    const finalize = async (output: ExecResult, terminateWorker = true) => {
      if (finished) return
      finished = true
      if (timeoutId) clearTimeout(timeoutId)
      worker.removeAllListeners()
      for (const ac of activeChildAborts) {
        try {
          ac.abort(new Error('tool_exec finished'))
        } catch {
          // ignore — abort can throw on already-aborted controllers
        }
      }
      activeChildAborts.clear()
      if (terminateWorker) {
        try {
          await worker.terminate()
        } catch (err) {
          logger.warn('failed to terminate exec worker', err as Error)
        }
      }
      resolve(output)
    }

    const handleToolCall = async (message: WorkerCallToolMessage) => {
      if (finished || timedOut) return
      const entry = ctx.registry.getByName(message.name)
      if (!entry) {
        worker.postMessage({
          type: 'toolError',
          requestId: message.requestId,
          error: `Tool not found: ${message.name}`
        })
        return
      }
      const execute = entry.tool.execute
      if (typeof execute !== 'function') {
        worker.postMessage({
          type: 'toolError',
          requestId: message.requestId,
          error: `Tool ${message.name} has no execute handler`
        })
        return
      }

      const childAbort = new AbortController()
      activeChildAborts.add(childAbort)
      const parentSignal = ctx.parentOptions.abortSignal
      const onParentAbort = () => childAbort.abort(parentSignal?.reason)
      if (parentSignal) {
        if (parentSignal.aborted) childAbort.abort(parentSignal.reason)
        else parentSignal.addEventListener('abort', onParentAbort, { once: true })
      }

      try {
        const result = await execute(message.params ?? {}, {
          ...ctx.parentOptions,
          toolCallId: `${ctx.parentOptions.toolCallId}::exec::${message.requestId}`,
          abortSignal: childAbort.signal
        })
        if (finished || timedOut) return
        worker.postMessage({ type: 'toolResult', requestId: message.requestId, result })
      } catch (err) {
        if (finished || timedOut) return
        const errorMessage = err instanceof Error ? err.message : String(err)
        worker.postMessage({ type: 'toolError', requestId: message.requestId, error: errorMessage })
      } finally {
        if (parentSignal) parentSignal.removeEventListener('abort', onParentAbort)
        activeChildAborts.delete(childAbort)
      }
    }

    const handleMessage = (message: WorkerMessage) => {
      if (!message || typeof message !== 'object') return
      switch (message.type) {
        case 'log':
          addLog(message.entry)
          break
        case 'callTool':
          void handleToolCall(message)
          break
        case 'result': {
          const resolvedLogs = message.logs && message.logs.length > 0 ? message.logs : logs
          void finalize({ result: message.result, logs: resolvedLogs.length > 0 ? resolvedLogs : undefined })
          break
        }
        case 'error': {
          const resolvedLogs = message.logs && message.logs.length > 0 ? message.logs : logs
          void finalize({
            result: undefined,
            logs: resolvedLogs.length > 0 ? resolvedLogs : undefined,
            error: message.error,
            isError: true
          })
          break
        }
        default:
          break
      }
    }

    worker.on('message', handleMessage)
    worker.on('error', (err) => {
      logger.error('exec worker errored', err)
      void finalize({
        result: undefined,
        logs: logs.length > 0 ? logs : undefined,
        error: err instanceof Error ? err.message : String(err),
        isError: true
      })
    })
    worker.on('exit', (code) => {
      if (finished || timedOut) return
      const message = code === 0 ? 'exec worker exited unexpectedly' : `exec worker exited with code ${code}`
      logger.error(message)
      void finalize(
        { result: undefined, logs: logs.length > 0 ? logs : undefined, error: message, isError: true },
        false
      )
    })

    worker.postMessage({ type: 'exec', code })
  })
}
