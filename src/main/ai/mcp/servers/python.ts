import { application } from '@application'
import { loggerService } from '@logger'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import * as z from 'zod'

const logger = loggerService.withContext('MCPServer:Python')

const DEFAULT_TIMEOUT_MS = 60000
const MIN_TIMEOUT_MS = 1000
const MAX_TIMEOUT_MS = 10 * 60 * 1000

const PythonExecuteArgsSchema = z.object({
  code: z.string().min(1, 'Code parameter is required and must be a string'),
  context: z.record(z.string(), z.any()).optional().default({}),
  timeout: z.number().positive().optional().default(DEFAULT_TIMEOUT_MS)
})

/**
 * Python MCP Server for executing Python code using Pyodide
 */
class PythonServer {
  public server: Server

  constructor() {
    this.server = new Server(
      {
        name: 'python-server',
        version: '1.0.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    )

    this.setupRequestHandlers()
  }

  private setupRequestHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'python_execute',
            description: `Execute Python code using Pyodide in a sandboxed environment. Supports most Python standard library and scientific packages.
The code will be executed with Python 3.12.
Dependencies may be defined via PEP 723 script metadata, e.g. to install "pydantic", the script should start
with a comment of the form:
# /// script
# dependencies = ['pydantic']
# ///
print('python code here')`,
            inputSchema: {
              type: 'object',
              properties: {
                code: {
                  type: 'string',
                  description: 'The Python code to execute'
                },
                context: {
                  type: 'object',
                  description: 'Optional context variables to pass to the Python execution environment',
                  additionalProperties: true
                },
                timeout: {
                  type: 'number',
                  description: 'Timeout in milliseconds (default: 60000)',
                  default: 60000
                }
              },
              required: ['code']
            }
          }
        ]
      }
    })

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params

      if (name !== 'python_execute') {
        throw new McpError(ErrorCode.MethodNotFound, `Tool ${name} not found`)
      }

      try {
        const parsed = PythonExecuteArgsSchema.safeParse(args)
        if (!parsed.success) {
          throw new McpError(ErrorCode.InvalidParams, `Invalid arguments for python_execute: ${parsed.error.message}`)
        }

        const { code, context } = parsed.data
        // Clamp timeout to a sane range to prevent runaway or pointless executions.
        const timeout = Math.min(Math.max(parsed.data.timeout, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS)

        logger.debug('Executing Python code via Pyodide')

        const result = await application.get('PythonService').executeScript(code, context, timeout)

        return {
          content: [
            {
              type: 'text',
              text: result
            }
          ]
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        logger.error(`Python execution error: ${errorMessage}`)

        throw new McpError(ErrorCode.InternalError, `Python execution failed: ${errorMessage}`)
      }
    })
  }
}

export default PythonServer
