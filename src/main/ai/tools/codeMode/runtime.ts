import { Worker } from 'node:worker_threads'

import { loggerService } from '@logger'

import { execWorkerSource } from './worker'

const logger = loggerService.withContext('codeMode.runtime')

const MAX_LOGS = 1000
const EXECUTION_TIMEOUT_MS = 60_000

export interface ExecResult {
  result: unknown
  logs?: string[]
  error?: string
  isError?: boolean
}

export interface ExecCodeContext {
  abortSignal?: AbortSignal
  executeTool(name: string, params: Record<string, unknown>, requestId: string, signal: AbortSignal): Promise<unknown>
  onExecutionStarted?: (controls: { pauseTimeout: () => void; resumeTimeout: () => void }) => void
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

/** Runtime-neutral worker orchestration; this is not a security sandbox. Replace the worker before
 * allowing untrusted code without an outer approval gate. */
export function runExecCode(code: string, ctx: ExecCodeContext): Promise<ExecResult> {
  return new Promise<ExecResult>((resolve) => {
    const logs: string[] = []
    const activeChildAborts = new Set<AbortController>()
    const worker = new Worker(execWorkerSource, { eval: true })
    const parentSignal = ctx.abortSignal
    let finished = false
    let timedOut = false
    let terminating = false
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    let timeoutStartedAt = 0
    let timeoutRemainingMs = EXECUTION_TIMEOUT_MS
    let timeoutPauseCount = 0

    const addLog = (entry: string) => {
      if (logs.length < MAX_LOGS) logs.push(entry)
    }

    const abortChildren = (reason: unknown) => {
      for (const ac of activeChildAborts) {
        try {
          ac.abort(reason)
        } catch {
          // ignore — abort can throw on already-aborted controllers
        }
      }
      activeChildAborts.clear()
    }

    const finalize = async (output: ExecResult, terminateWorker = true) => {
      if (finished) return
      finished = true
      if (timeoutId) clearTimeout(timeoutId)
      parentSignal?.removeEventListener('abort', onParentAbort)
      worker.removeAllListeners()
      abortChildren(new Error('tool_exec finished'))
      if (terminateWorker) {
        try {
          await worker.terminate()
        } catch (err) {
          logger.warn('failed to terminate exec worker', err as Error)
        }
      }
      resolve(output)
    }

    const terminateWithError = async (error: string, childAbortReason: unknown = new Error(error)) => {
      if (finished || terminating) return
      terminating = true
      if (timeoutId) clearTimeout(timeoutId)
      abortChildren(childAbortReason)
      worker.removeAllListeners()
      try {
        await worker.terminate()
      } catch (err) {
        logger.warn('failed to terminate exec worker', err as Error)
      }
      await finalize(
        {
          result: undefined,
          logs: logs.length > 0 ? logs : undefined,
          error,
          isError: true
        },
        false
      )
    }

    const onParentAbort = () => {
      const reason = parentSignal?.reason
      const message = reason instanceof Error ? reason.message : reason === undefined ? 'aborted' : String(reason)
      void terminateWithError(`tool_exec aborted: ${message}`, reason)
    }

    const scheduleTimeout = () => {
      if (finished || terminating || timeoutPauseCount > 0) return
      timeoutStartedAt = Date.now()
      timeoutId = setTimeout(() => {
        timedOut = true
        void terminateWithError(`tool_exec timed out after ${EXECUTION_TIMEOUT_MS}ms`)
      }, timeoutRemainingMs)
    }
    const pauseTimeout = () => {
      if (finished || timedOut || terminating || timeoutPauseCount++ > 0) return
      if (!timeoutId) return
      clearTimeout(timeoutId)
      timeoutId = undefined
      timeoutRemainingMs -= Date.now() - timeoutStartedAt
    }
    const resumeTimeout = () => {
      if (finished || timedOut || terminating || timeoutPauseCount === 0 || --timeoutPauseCount > 0) return
      scheduleTimeout()
    }

    scheduleTimeout()
    ctx.onExecutionStarted?.({ pauseTimeout, resumeTimeout })

    if (parentSignal?.aborted) {
      onParentAbort()
      return
    }
    parentSignal?.addEventListener('abort', onParentAbort, { once: true })

    const handleToolCall = async (message: WorkerCallToolMessage) => {
      if (finished || timedOut || terminating) return
      const childAbort = new AbortController()
      activeChildAborts.add(childAbort)
      if (parentSignal?.aborted) childAbort.abort(parentSignal.reason)

      try {
        const result = await ctx.executeTool(message.name, message.params ?? {}, message.requestId, childAbort.signal)
        if (finished || timedOut || terminating) return
        worker.postMessage({ type: 'toolResult', requestId: message.requestId, result })
      } catch (err) {
        if (finished || timedOut || terminating) return
        const errorMessage = err instanceof Error ? err.message : String(err)
        worker.postMessage({ type: 'toolError', requestId: message.requestId, error: errorMessage })
      } finally {
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
