import { loggerService } from '@logger'

import { callMcpTool } from './mcp-bridge'
import type { ConsoleMethods, ExecOutput, ExecutionContext, GeneratedTool } from './types'

const logger = loggerService.withContext('MCPServer:Hub:Runtime')

const MAX_LOGS = 1000
const EXECUTION_TIMEOUT = 60000

export class Runtime {
  async execute(code: string, tools: GeneratedTool[]): Promise<ExecOutput> {
    const logs: string[] = []
    const capturedConsole = this.createCapturedConsole(logs)

    try {
      const context = this.buildContext(tools, capturedConsole)
      const result = await this.runCode(code, context)

      return {
        result,
        logs: logs.length > 0 ? logs : undefined
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('Execution error:', error as Error)

      return {
        result: undefined,
        logs: logs.length > 0 ? logs : undefined,
        error: errorMessage
      }
    }
  }

  private buildContext(tools: GeneratedTool[], capturedConsole: ConsoleMethods): ExecutionContext {
    const context: ExecutionContext = {
      __callTool: callMcpTool,
      parallel: <T>(...promises: Promise<T>[]) => Promise.all(promises),
      settle: <T>(...promises: Promise<T>[]) => Promise.allSettled(promises),
      console: capturedConsole
    }

    for (const tool of tools) {
      context[tool.functionName] = tool.fn
    }

    return context
  }

  private async runCode(code: string, context: ExecutionContext): Promise<unknown> {
    const contextKeys = Object.keys(context)
    const contextValues = contextKeys.map((k) => context[k])

    const wrappedCode = `
      return (async () => {
        ${code}
      })()
    `

    const fn = new Function(...contextKeys, wrappedCode)

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Execution timed out after ${EXECUTION_TIMEOUT}ms`))
      }, EXECUTION_TIMEOUT)
    })

    const executionPromise = fn(...contextValues)

    return Promise.race([executionPromise, timeoutPromise])
  }

  private createCapturedConsole(logs: string[]): ConsoleMethods {
    const addLog = (level: string, ...args: unknown[]) => {
      if (logs.length >= MAX_LOGS) {
        return
      }
      const message = args.map((arg) => this.stringify(arg)).join(' ')
      logs.push(`[${level}] ${message}`)
    }

    return {
      log: (...args: unknown[]) => addLog('log', ...args),
      warn: (...args: unknown[]) => addLog('warn', ...args),
      error: (...args: unknown[]) => addLog('error', ...args),
      info: (...args: unknown[]) => addLog('info', ...args),
      debug: (...args: unknown[]) => addLog('debug', ...args)
    }
  }

  private stringify(value: unknown): string {
    if (value === undefined) return 'undefined'
    if (value === null) return 'null'
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    if (value instanceof Error) return value.message

    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  }
}
