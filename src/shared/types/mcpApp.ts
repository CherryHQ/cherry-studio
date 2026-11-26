import * as z from 'zod'

import { isDeferredToolOutput, isPersistedToolOutput } from '@shared/ai/transport'

export const McpAppReferenceSchema = z.strictObject({
  serverId: z.string().min(1),
  toolName: z.string().min(1),
  serverKey: z.string().min(1),
  resourceUri: z.string().startsWith('ui://').max(8192)
})

export type McpAppReference = z.infer<typeof McpAppReferenceSchema>

const McpAppResultReferenceMetadataSchema = z.object({
  type: z.literal('mcp'),
  app: McpAppReferenceSchema
})

export const McpAppResultMetadataSchema = McpAppResultReferenceMetadataSchema.extend({
  appInput: z.record(z.string(), z.unknown())
})

export function hasMcpAppResult(output: unknown): boolean {
  if (isDeferredToolOutput(output)) return output.hasMcpApp === true
  if (isPersistedToolOutput(output)) {
    const ref = output.$persistedToolOutput
    if (ref.shape === 'mcp-content') return McpAppResultReferenceMetadataSchema.safeParse(ref.metadata).success
    output = ref.shape === 'entities' ? ref.skeleton : undefined
  }
  return (
    typeof output === 'object' &&
    output !== null &&
    'metadata' in output &&
    McpAppResultReferenceMetadataSchema.safeParse(output.metadata).success
  )
}

export const McpAppMessageReferenceSchema = z.object({
  topicId: z.string().min(1),
  messageId: z.string().min(1),
  toolCallId: z.string().min(1)
})

export const mcpAppGuestMessage = 'mcp-app:guest-message'
export const mcpAppHostMessage = 'mcp-app:host-message'
