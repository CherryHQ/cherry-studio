// port from https://github.com/jlucaso1/mcp-javascript-sandbox
import { loggerService } from '@logger'
import { jsService } from '@main/services/JsService'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types'
import * as z from 'zod'

const TOOL_NAME = 'run_javascript_code'
const DEFAULT_TIMEOUT = 60_000

export const RequestPayloadSchema = z.object({
  javascript_code: z.string().min(1).describe('The JavaScript code to execute in the sandbox.'),
  timeout: z
    .number()
    .int()
    .positive()
    .max(5 * 60_000)
    .optional()
    .describe('Execution timeout in milliseconds (default 60000, max 300000).')
})

const logger = loggerService.withContext('MCPServer:JavaScript')

function formatExecutionResult(result: {
  stdout: string
  stderr: string
  error?: string | undefined
  exitCode: number
}) {
  let combinedOutput = ''
  if (result.stdout) {
    combinedOutput += result.stdout
  }
  if (result.stderr) {
    combinedOutput += `--- stderr ---\n${result.stderr}\n--- stderr ---\n`
  }
  if (result.error) {
    combinedOutput += `--- Execution Error ---\n${result.error}\n--- Execution Error ---\n`
  }

  const isError = Boolean(result.error) || Boolean(result.stderr?.trim()) || result.exitCode !== 0

  return {
    combinedOutput: combinedOutput.trim(),
    isError
  }
}

class JsServer {
  public server: Server

  constructor() {
    this.server = new Server(
      {
        name: 'MCP QuickJS Runner',
        version: '1.0.0',
        description: 'An MCP server that provides a tool to execute JavaScript code in a QuickJS WASM sandbox.'
      },
      {
        capabilities: {
          resources: {},
          tools: {}
        }
      }
    )

    this.setupHandlers()
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: TOOL_NAME,
            description:
              'Executes the provided JavaScript code in a secure WASM sandbox (QuickJS). Returns stdout and stderr. Non-zero exit code indicates an error.',
            inputSchema: z.toJSONSchema(RequestPayloadSchema)
          }
        ]
      }
    })

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params

      if (name !== TOOL_NAME) {
        return {
          content: [{ type: 'text', text: `Tool not found: ${name}` }],
          isError: true
        }
      }

      const parseResult = RequestPayloadSchema.safeParse(args)
      if (!parseResult.success) {
        return {
          content: [{ type: 'text', text: `Invalid arguments: ${parseResult.error.message}` }],
          isError: true
        }
      }

      const { javascript_code, timeout } = parseResult.data

      try {
        logger.debug('Executing JavaScript code via JsService')
        const result = await jsService.executeScript(javascript_code, {
          timeout: timeout ?? DEFAULT_TIMEOUT
        })

        const { combinedOutput, isError } = formatExecutionResult(result)

        return {
          content: [
            {
              type: 'text',
              text: combinedOutput
            }
          ],
          isError
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error(`JavaScript execution failed: ${message}`)

        return {
          content: [
            {
              type: 'text',
              text: `Server error during tool execution: ${message}`
            }
          ],
          isError: true
        }
      }
    })
  }
}

export default JsServer
