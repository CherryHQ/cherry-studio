import * as z from 'zod'

export const McpAppReferenceSchema = z.strictObject({
  serverId: z.string().min(1),
  toolName: z.string().min(1),
  serverKey: z.string().min(1),
  resourceUri: z.string().startsWith('ui://').max(8192)
})

export type McpAppReference = z.infer<typeof McpAppReferenceSchema>

export const McpAppResultMetadataSchema = z.object({
  type: z.literal('mcp'),
  app: McpAppReferenceSchema,
  appInput: z.record(z.string(), z.unknown())
})

export const McpAppMessageReferenceSchema = z.object({
  topicId: z.string().min(1),
  messageId: z.string().min(1),
  toolCallId: z.string().min(1)
})

export const mcpAppGuestMessage = 'mcp-app:guest-message'
export const mcpAppHostMessage = 'mcp-app:host-message'
