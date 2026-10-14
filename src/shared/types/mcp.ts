import { PromptSchema, ResourceSchema, ResourceTemplateSchema, type ToolSchema } from '@modelcontextprotocol/core'
import * as z from 'zod'

const serverOrigin = { serverId: z.string(), serverName: z.string() }

export const MCP_SERVER_INSTRUCTIONS_MAX_CHARS = 32_768
export const McpServerInstructionsSchema = z.object({
  ...serverOrigin,
  text: z.string().max(MCP_SERVER_INSTRUCTIONS_MAX_CHARS),
  truncated: z.boolean()
})
export type McpServerInstructions = z.infer<typeof McpServerInstructionsSchema>

export const McpPromptSchema = PromptSchema.extend({ ...serverOrigin, id: z.string() })
export const McpResourceSchema = ResourceSchema.extend({
  ...serverOrigin,
  text: z.string().optional(),
  blob: z.string().optional()
})
export const McpResourceTemplateSchema = ResourceTemplateSchema.extend(serverOrigin)
export type McpResourceTemplate = z.infer<typeof McpResourceTemplateSchema>

export type McpProgressEvent = {
  callId: string
  progress: number // 0-1 range
}

export type McpServerLogEntry = {
  timestamp: number
  level: 'debug' | 'info' | 'warn' | 'error' | 'stderr' | 'stdout'
  message: string
  data?: unknown
  source?: string
}

/**
 * MCP tool descriptor as seen by the renderer through shared cache. Main
 * process `McpCatalogService` is the sole producer.
 */
export type McpTool = z.infer<typeof ToolSchema> & {
  /** AI SDK wire ID; readable slugs use display names, while the identity digest uses `serverId` + original `name`. */
  id: string
  type: 'mcp'
  serverId: string
  serverName: string
}

export type McpPrompt = z.infer<typeof McpPromptSchema>
export type McpPromptArguments = NonNullable<McpPrompt['arguments']>[number]
export type McpResource = z.infer<typeof McpResourceSchema>
