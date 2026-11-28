import * as z from 'zod'

export function supportsHistoryImport(type: string): boolean {
  return type === 'pi-durable' || type === 'pi'
}

export const HISTORY_IMPORT_BATCH_SIZE = 100

export const HistorySourceSchema = z.enum(['claude-code', 'codex', 'opencode', 'workbuddy', 'dsh'])
export type HistorySource = z.infer<typeof HistorySourceSchema>

export const AgentSessionImportMetadataSchema = z.strictObject({
  source: HistorySourceSchema,
  originalSessionId: z.string().min(1)
})
export type AgentSessionImportMetadata = z.infer<typeof AgentSessionImportMetadataSchema>

export const MessageProvenanceSchema = z.strictObject({
  source: HistorySourceSchema,
  sourceOrder: z.number().int().nonnegative(),
  isSetup: z.literal(true).optional()
})
export type MessageProvenance = z.infer<typeof MessageProvenanceSchema>
