import crypto from 'node:crypto'
import { Worker } from 'node:worker_threads'

import { loggerService } from '@logger'

import { abortMcpTool, callMcpTool } from './mcp-bridge'
import type {
  ExecOutput,
  GeneratedTool,
  HubWorkerCallToolMessage,
  HubWorkerExecMessage,
  HubWorkerMessage,
  HubWorkerResultMessage
} from './types'
import { hubWorkerSource } from './worker'

const logger = loggerService.withContext('MCPServer:Hub:Runtime')

const MAX_LOGS = 1000
const EXECUTION_TIMEOUT = 60000

export class Runtime {
  async execute(code: string, tools: GeneratedTool[]): Promise<ExecOutput> {
    return await new Promise<ExecOutput>((resolve) => {
      const logs: string[] = []
      const activeCallIds = new Map<string, string>()
      let finished = false
      let timedOut = false
      let timeoutId: NodeJS.Timeout | null = null

      const worker = new Worker(hubWorkerSource, { eval: true })

      const addLog = (entry: string) => {
        if (logs.length >= MAX_LOGS) {
          return
        }
        logs.push(entry)
      }

      const finalize = async (output: ExecOutput, terminateWorker = true) => {
        if (finished) {
          return
        }
        finished = true
        if (timeoutId) {
          clearTimeout(timeoutId)
        }
        worker.removeAllListeners()
        if (terminateWorker) {
          try {
            await worker.terminate()
          } catch (error) {
            logger.warn('Failed to terminate exec worker', error as Error)
          }
        }
        resolve(output)
      }

      const abortActiveTools = async () => {
        const callIds = Array.from(activeCallIds.values())
        activeCallIds.clear()
        if (callIds.length === 0) {
          return
        }
        await Promise.allSettled(callIds.map((callId) => abortMcpTool(callId)))
      }

      const handleToolCall = async (message: HubWorkerCallToolMessage) => {
        if (finished || timedOut) {
          return
        }
        const callId = crypto.randomUUID()
        activeCallIds.set(message.requestId, callId)

        try {
          const result = await callMcpTool(message.functionName, message.params, callId)
          if (finished || timedOut) {
            return
          }
          worker.postMessage({ type: 'toolResult', requestId: message.requestId, result })
        } catch (error) {
          if (finished || timedOut) {
            return
          }
          const errorMessage = error instanceof Error ? error.message : String(error)
          worker.postMessage({ type: 'toolError', requestId: message.requestId, error: errorMessage })
        } finally {
          activeCallIds.delete(message.requestId)
        }
      }

      const handleResult = (message: HubWorkerResultMessage) => {
        const resolvedLogs = message.logs && message.logs.length > 0 ? message.logs : logs
        void finalize({
          result: message.result,
          logs: resolvedLogs.length > 0 ? resolvedLogs : undefined
        })
      }

      const handleError = (errorMessage: string, messageLogs?: string[], terminateWorker = true) => {
        const resolvedLogs = messageLogs && messageLogs.length > 0 ? messageLogs : logs
        void finalize(
          {
            result: undefined,
            logs: resolvedLogs.length > 0 ? resolvedLogs : undefined,
            error: errorMessage,
            isError: true
          },
          terminateWorker
        )
      }

      const handleMessage = (message: HubWorkerMessage) => {
        if (!message || typeof message !== 'object') {
          return
        }
        switch (message.type) {
          case 'log':
            addLog(message.entry)
            break
          case 'callTool':
            void handleToolCall(message)
            break
          case 'result':
            handleResult(message)
            break
          case 'error':
            handleError(message.error, message.logs)
            break
          default:
            break
        }
      }

      timeoutId = setTimeout(() => {
        timedOut = true
        void (async () => {
          await abortActiveTools()
          try {
            await worker.terminate()
          } catch (error) {
            logger.warn('Failed to terminate exec worker after timeout', error as Error)
          }
          handleError(`Execution timed out after ${EXECUTION_TIMEOUT}ms`, undefined, false)
        })()
      }, EXECUTION_TIMEOUT)

      worker.on('message', handleMessage)
      worker.on('error', (error) => {
        logger.error('Worker execution error', error)
        handleError(error instanceof Error ? error.message : String(error))
      })
      worker.on('exit', (code) => {
        if (finished || timedOut) {
          return
        }
        const message = code === 0 ? 'Exec worker exited unexpectedly' : `Exec worker exited with code ${code}`
        logger.error(message)
        handleError(message, undefined, false)
      })

      const execMessage: HubWorkerExecMessage = {
        type: 'exec',
        code,
        tools: tools.map((tool) => ({ functionName: tool.functionName }))
      }
      worker.postMessage(execMessage)
    })
  }
}
