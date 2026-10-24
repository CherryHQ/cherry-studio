import { dynamicTool, type ToolSet } from 'ai'
import * as z from 'zod'

// The agent's code tools. `python_execute` is the desktop Python MCP tool: the desktop `PythonService` in
// the Worker runs it in the page's Pyodide. `js_execute` runs JavaScript in a QuickJS Worker of its own.
import { application } from '@application'

import { textResult } from './fileTools'
import type { JsSandboxResult } from './jsSandbox.worker'

const DEFAULT_TIMEOUT_MS = 60_000
const MIN_TIMEOUT_MS = 1_000
const MAX_TIMEOUT_MS = 10 * 60 * 1000

/** The desktop `python_execute` schema (`@main/ai/mcp/servers/python.ts`). */
const pythonExecuteInputSchema = z.object({
  code: z.string().min(1, 'Code parameter is required and must be a string').describe('The Python code to execute'),
  context: z
    .record(z.string(), z.any())
    .optional()
    .default({})
    .describe('Optional context variables to pass to the Python execution environment'),
  timeout: z
    .number()
    .positive()
    .optional()
    .default(DEFAULT_TIMEOUT_MS)
    .describe('Timeout in milliseconds (default: 60000)')
})

const JS_DEFAULT_TIMEOUT_MS = 30_000
const JS_MAX_TIMEOUT_MS = 5 * 60 * 1000

const jsExecuteInputSchema = z.object({
  code: z.string().min(1).describe('The JavaScript to run. Top-level await is allowed.'),
  timeout: z
    .number()
    .positive()
    .optional()
    .default(JS_DEFAULT_TIMEOUT_MS)
    .describe('Timeout in milliseconds (default: 30000)')
})

/** Runs a script in a fresh sandbox Worker, terminated when it settles or times out. */
async function runJs(code: string, timeout: number): Promise<string> {
  const worker = new Worker(new URL('./jsSandbox.worker.ts', import.meta.url), { type: 'module' })
  try {
    const run = Promise.withResolvers<JsSandboxResult>()
    worker.onmessage = ({ data }: MessageEvent<JsSandboxResult>) => run.resolve(data)
    worker.onerror = (event) => run.reject(new Error(event.message || 'The JavaScript sandbox failed to start'))
    const timer = setTimeout(() => run.reject(new Error(`JavaScript execution timed out after ${timeout} ms`)), timeout)
    worker.postMessage(code)
    const result = await run.promise.finally(() => clearTimeout(timer))
    const text = [result.output, 'error' in result ? result.error : result.result].filter(Boolean).join('\n')
    if ('error' in result) throw new Error(text)
    return text
  } finally {
    worker.terminate()
  }
}

export function createCodeTools(): ToolSet {
  return {
    python_execute: dynamicTool({
      description:
        'Run Python 3.12 in Pyodide. Declare dependencies with PEP 723 script metadata (a # /// script block).',
      inputSchema: pythonExecuteInputSchema,
      execute: async (input) => {
        const { code, context, timeout } = pythonExecuteInputSchema.parse(input)
        const clamped = Math.min(Math.max(timeout, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS)
        return textResult(await application.get('PythonService').executeScript(code, context, clamped))
      }
    }),
    js_execute: dynamicTool({
      description:
        'Run JavaScript in an isolated QuickJS sandbox without network, file or DOM access. Returns console output and the value of the last expression.',
      inputSchema: jsExecuteInputSchema,
      execute: async (input) => {
        const { code, timeout } = jsExecuteInputSchema.parse(input)
        return textResult(await runJs(code, Math.min(Math.max(timeout, MIN_TIMEOUT_MS), JS_MAX_TIMEOUT_MS)))
      }
    })
  }
}
