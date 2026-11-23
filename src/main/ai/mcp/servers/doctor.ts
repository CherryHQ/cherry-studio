import { type CallToolResult, fromJsonSchema, McpServer } from '@modelcontextprotocol/server'

import { application } from '@application'
import { loggerService } from '@logger'
import { DOCTOR_TOOLS, type DoctorToolArgs, ToolError } from '@main/ai/agents/doctor/doctorTools'
import { getErrorMessage } from '@main/utils/error'

const logger = loggerService.withContext('DoctorServer')

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Doctor tools catch arbitrary failures; expose the owned ToolError code while safely formatting other rejection values.
function formatToolError(error: unknown): string {
  const message = getErrorMessage(error, 'Tool execution failed')

  if (error instanceof ToolError && error.code !== undefined) return `MCP error ${error.code}: ${message}`

  return message
}

/** In-process MCP server mounted only for the doctor built-in Agent; see `agents/doctor/doctorTools`. */
export function createDoctorServer(sessionId: string): McpServer {
  const server = new McpServer({ name: 'doctor', version: '1.0.0' })

  for (const tool of DOCTOR_TOOLS) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: fromJsonSchema<DoctorToolArgs>(tool.inputSchema)
      },
      async (args): Promise<CallToolResult> => {
        try {
          application.get('DoctorAgentService').reportBindingForSession(sessionId)

          return await tool.handler(args, { sessionId })
        } catch (error) {
          const message = formatToolError(error)
          logger.error(`Tool error: ${tool.name}`, { error: message })

          return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true }
        }
      }
    )
  }

  return server
}
