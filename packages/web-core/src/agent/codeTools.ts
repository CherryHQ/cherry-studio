import { dynamicTool, type ToolSet } from 'ai'
import * as z from 'zod'

// The agent's code tools. `python_execute` is the desktop Python MCP tool: the desktop `PythonService` in
// the Worker runs it in the page's Pyodide.
import { application } from '@application'

import { textResult } from './fileTools'

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
    })
  }
}
