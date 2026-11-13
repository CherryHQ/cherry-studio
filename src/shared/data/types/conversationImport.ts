import * as z from 'zod'

export const HistorySourceSchema = z.enum(['claude-code', 'codex', 'opencode', 'workbuddy'])
export type HistorySource = z.infer<typeof HistorySourceSchema>

export const AgentSessionImportMetadataSchema = z.strictObject({
  source: HistorySourceSchema,
  originalSessionId: z.string().min(1)
})
export type AgentSessionImportMetadata = z.infer<typeof AgentSessionImportMetadataSchema>

export const MessageProvenanceSchema = z.strictObject({
  source: HistorySourceSchema,
  sourceOrder: z.number().int().nonnegative()
})
export type MessageProvenance = z.infer<typeof MessageProvenanceSchema>
