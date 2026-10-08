import { type CallToolResult, fromJsonSchema, type JsonSchemaType, McpServer } from '@modelcontextprotocol/server'

import { loggerService } from '@logger'
import { DOCTOR_TOOLS, ToolError } from '@main/ai/agents/doctor/doctorTools'

const logger = loggerService.withContext('DoctorServer')

function formatToolError(error: unknown): string {
  if (error instanceof ToolError && error.code !== undefined) return `MCP error ${error.code}: ${error.message}`
  return error instanceof Error ? error.message : String(error)
}

/** In-process MCP server mounted only for the doctor built-in Agent; see `agents/doctor/doctorTools`. */
export function createDoctorServer(sessionId: string): McpServer {
  const server = new McpServer({ name: 'doctor', version: '1.0.0' })
  for (const tool of DOCTOR_TOOLS) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: fromJsonSchema<Record<string, unknown>>(tool.inputSchema as JsonSchemaType)
      },
      async (args): Promise<CallToolResult> => {
        try {
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
