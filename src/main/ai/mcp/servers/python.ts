import { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod'

import { application } from '@application'
import { loggerService } from '@logger'

const logger = loggerService.withContext('McpServer:Python')

const DEFAULT_TIMEOUT_MS = 60000
const MIN_TIMEOUT_MS = 1000
const MAX_TIMEOUT_MS = 10 * 60 * 1000

const PythonExecuteArgsSchema = z.object({
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

/** Python MCP server that executes code with Pyodide. */
export function createPythonServer(): McpServer {
  const server = new McpServer({ name: 'python-server', version: '1.0.0' })

  server.registerTool(
    'python_execute',
    {
      description: `Execute Python code using Pyodide in a sandboxed environment. Supports most Python standard library and scientific packages.
The code will be executed with Python 3.12.
Dependencies may be defined via PEP 723 script metadata, e.g. to install "pydantic", the script should start
with a comment of the form:
# /// script
# dependencies = ['pydantic']
# ///
print('python code here')`,
      inputSchema: PythonExecuteArgsSchema
    },
    async ({ code, context, timeout }) => {
      // Clamp timeout to a sane range to prevent runaway or pointless executions.
      const clampedTimeout = Math.min(Math.max(timeout, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS)

      logger.debug('Executing Python code via Pyodide')

      try {
        const result = await application.get('PythonService').executeScript(code, context, clampedTimeout)
        return { content: [{ type: 'text', text: result }] }
      } catch (error) {
        logger.error('Python execution error', error as Error)
        throw error
      }
    }
  )
  return server
}
