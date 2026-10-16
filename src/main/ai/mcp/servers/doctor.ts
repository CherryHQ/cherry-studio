import { type CallToolResult, fromJsonSchema, type JsonSchemaType, McpServer } from '@modelcontextprotocol/server'

import { application } from '@application'
import { loggerService } from '@logger'
import { DOCTOR_TOOLS, ToolError } from '@main/ai/agents/doctor/doctorTools'
import type { DoctorAgentIncident } from '@shared/types/doctorAgent'
import { isOperationIncident } from '@shared/utils/doctor'

const logger = loggerService.withContext('DoctorServer')

/** Conversation tools exist only for a failed message. Report-only and operation analyses omit them. */
function hasConversationIncident(incident: DoctorAgentIncident | undefined): boolean {
  return incident !== undefined && !isOperationIncident(incident)
}

function formatToolError(error: unknown): string {
  if (error instanceof ToolError && error.code !== undefined) return `MCP error ${error.code}: ${error.message}`
  return error instanceof Error ? error.message : String(error)
}

/** In-process MCP server mounted only for the doctor built-in Agent; see `agents/doctor/doctorTools`. */
export function createDoctorServer(sessionId: string): McpServer {
  const server = new McpServer({ name: 'doctor', version: '1.0.0' })
  const incident = application.get('DoctorAgentService').incidentForSession(sessionId)
  const tools = hasConversationIncident(incident)
    ? DOCTOR_TOOLS
    : DOCTOR_TOOLS.filter((tool) => tool.name !== 'session')
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: fromJsonSchema<Record<string, unknown>>(tool.inputSchema as JsonSchemaType)
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
