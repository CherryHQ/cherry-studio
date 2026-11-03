import * as z from 'zod'

export const HistorySourceSchema = z.enum(['claude-code', 'codex', 'opencode', 'workbuddy'])
export type HistorySource = z.infer<typeof HistorySourceSchema>

export const AgentSessionImportMetadataSchema = z.strictObject({
  version: z.literal(1),
  source: HistorySourceSchema,
  originalSessionId: z.string().min(1),
  sourcePaths: z.array(z.string()),
  sourceVersion: z.string().optional(),
  originalWorkingDirectory: z.string().optional(),
  sourceFingerprint: z.string(),
  importedAt: z.iso.datetime(),
  adapterVersion: z.number().int().positive(),
  report: z.strictObject({
    skippedRecords: z.number().int().nonnegative(),
    downgradedParts: z.number().int().nonnegative()
  })
})
export type AgentSessionImportMetadata = z.infer<typeof AgentSessionImportMetadataSchema>

export const MessageProvenanceSchema = z.strictObject({
  source: HistorySourceSchema,
  originalMessageId: z.string(),
  sourceOrder: z.number().int().nonnegative(),
  originalTimestamp: z.string().optional(),
  inferredTimestamp: z.boolean()
})
export type MessageProvenance = z.infer<typeof MessageProvenanceSchema>
