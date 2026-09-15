import * as z from 'zod'

const hash = z.string().regex(/^[a-f0-9]{64}$/)
const range = z.strictObject({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() })
export const ForkContextSegmentSchema = z.strictObject({
  segmentId: z.string(),
  kind: z.enum(['summary', 'history', 'attachment-reference']),
  sourceRole: z.enum(['user', 'assistant', 'tool', 'mixed']),
  text: z.string(),
  contentHash: hash,
  sourceSnapshotId: z.string(),
  sourceMessageIds: z.array(z.string()),
  sourceRanges: z.array(range),
  isMultimodalReference: z.boolean()
})
export const ForkContextSnapshotSchema = z.strictObject({
  snapshotId: z.string(),
  hash,
  hadCompaction: z.boolean(),
  entries: z.array(
    z.strictObject({
      ordinal: z.number().int().nonnegative(),
      messageId: z.string(),
      turnId: z.string(),
      role: z.enum(['user', 'assistant', 'mixed']),
      text: z.string(),
      contentHash: hash,
      isMultimodalReference: z.boolean()
    })
  )
})
export const ForkContextCompatibilitySchema = z.strictObject({
  runtime: z.string(),
  schemaVersion: z.literal(1),
  sdkVersion: z.string(),
  systemPromptHash: hash,
  toolsetHash: hash,
  compressorHash: hash,
  modelHash: hash
})
export const ForkContextSummarySchema = z.strictObject({
  summaryId: z.string(),
  parentSummaryId: z.string().optional(),
  sourceType: z.enum(['native', 'regenerated']),
  nativeIdentity: z.string().optional(),
  captureProof: z.strictObject({ checkpointHash: hash, prefixHash: hash }).optional(),
  compatibility: ForkContextCompatibilitySchema,
  coveredStart: z.number().int().nonnegative(),
  coveredEnd: z.number().int().nonnegative(),
  inputSnapshotId: z.string(),
  inputSnapshotHash: hash,
  inputMessageIds: z.array(z.string()),
  segments: z.array(ForkContextSegmentSchema),
  retainedSegments: z.array(ForkContextSegmentSchema),
  layout: z.array(z.string())
})
export const ForkContextErrorSchema = z.strictObject({
  code: z.enum(['network', 'configuration', 'boundary', 'corrupt', 'budget', 'native_uncertain', 'cancelled']),
  category: z.enum(['retryable', 'not_retryable', 'needs_reconciliation', 'cancelled'])
})
export const PreparedForkContextSchema = z.strictObject({
  preparedContextId: z.string(),
  compatibility: ForkContextCompatibilitySchema,
  summaryId: z.string().optional(),
  segments: z.array(ForkContextSegmentSchema),
  historyHash: hash,
  budget: z.number().int().positive()
})
export const ForkContextAuditSchema = z.strictObject({
  attemptId: z.string(),
  preparedContextId: z.string(),
  summaryId: z.string().optional(),
  snapshotId: z.string(),
  coveredEnd: z.number().int().nonnegative(),
  segmentHashes: z.array(hash),
  historyHash: hash,
  messageId: z.string(),
  assistantMessageId: z.string(),
  compatibility: ForkContextCompatibilitySchema,
  submittedAt: z.number(),
  confirmedAt: z.number().optional(),
  outcome: z.enum(['sending', 'sent', 'uncertain']),
  resumeToken: z.string().optional()
})
export const ForkContextDocumentSchema = z.strictObject({
  version: z.literal(2),
  snapshot: ForkContextSnapshotSchema,
  summaries: z.array(ForkContextSummarySchema),
  headSummaryId: z.string().optional(),
  prepared: PreparedForkContextSchema.optional(),
  state: z.enum(['forkCreated', 'contextPreparing', 'contextReady', 'sending', 'sent', 'failed', 'cancelled']),
  error: ForkContextErrorSchema.optional(),
  audits: z.array(ForkContextAuditSchema)
})
export type ForkContextSegment = z.infer<typeof ForkContextSegmentSchema>
export type ForkContextSnapshot = z.infer<typeof ForkContextSnapshotSchema>
export type ForkContextCompatibility = z.infer<typeof ForkContextCompatibilitySchema>
export type ForkContextSummary = z.infer<typeof ForkContextSummarySchema>
export type PreparedForkContext = z.infer<typeof PreparedForkContextSchema>
export type ForkContextDocument = z.infer<typeof ForkContextDocumentSchema>
export type ForkContextError = z.infer<typeof ForkContextErrorSchema>

/** Upgrade disposable native summaries without changing durable send receipts. */
export function upgradeForkContextDocument(value: unknown): unknown {
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1) return value
  const candidate = { ...value, version: 2 }
  const parsed = ForkContextDocumentSchema.safeParse(candidate)
  if (!parsed.success) return candidate
  const document = parsed.data
  const invalid = new Set(
    document.summaries.filter((summary) => summary.sourceType === 'native').map((s) => s.summaryId)
  )
  for (let size = -1; size !== invalid.size;) {
    size = invalid.size
    for (const summary of document.summaries)
      if (summary.parentSummaryId && invalid.has(summary.parentSummaryId)) invalid.add(summary.summaryId)
  }
  if (invalid.size) {
    document.snapshot.hadCompaction = true
    document.summaries = document.summaries.filter((summary) => !invalid.has(summary.summaryId))
    if (document.headSummaryId && invalid.has(document.headSummaryId)) document.headSummaryId = undefined
    if (
      document.prepared?.summaryId &&
      invalid.has(document.prepared.summaryId) &&
      document.state !== 'sending' &&
      document.state !== 'sent' &&
      document.error?.category !== 'needs_reconciliation'
    )
      document.prepared = undefined
  }
  return document
}
