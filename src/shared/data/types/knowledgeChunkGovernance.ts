import * as z from 'zod'

export const KnowledgeChunkGovernanceStateSchema = z.strictObject({
  excluded: z.boolean(),
  labels: z.array(z.string().trim().min(1)).transform((labels) => [...new Set(labels)].sort()),
  overrideText: z.string().min(1).nullable()
})
export type KnowledgeChunkGovernanceState = z.infer<typeof KnowledgeChunkGovernanceStateSchema>

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/)
export const KnowledgeChunkGovernanceSourceSchema = z
  .strictObject({
    baseId: z.uuid(),
    itemId: z.uuid(),
    unitId: hashSchema,
    sourceContentHash: hashSchema,
    charStart: z.number().int().nonnegative(),
    charEnd: z.number().int().positive(),
    originalText: z.string().min(1)
  })
  .refine((value) => value.charEnd - value.charStart === value.originalText.length, {
    message: 'Original text must match the source offset range',
    path: ['charEnd']
  })
export type KnowledgeChunkGovernanceSource = z.infer<typeof KnowledgeChunkGovernanceSourceSchema>

export const KnowledgeChunkGovernanceViewSchema = z.strictObject({
  sourceContentHash: hashSchema,
  revision: z.number().int().nonnegative(),
  excluded: z.boolean(),
  labels: z.array(z.string()),
  status: z.enum(['active', 'excluded', 'pending', 'review-needed'])
})
export type KnowledgeChunkGovernanceView = z.infer<typeof KnowledgeChunkGovernanceViewSchema>

export const KnowledgeChunkBatchActionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('exclusion'), excluded: z.boolean() }),
  z.strictObject({
    kind: z.literal('label'),
    operation: z.enum(['add', 'remove']),
    label: z.string().trim().min(1).max(80)
  })
])
export type KnowledgeChunkBatchAction = z.infer<typeof KnowledgeChunkBatchActionSchema>

export const KnowledgeChunkBatchInputSchema = z.strictObject({
  baseId: z.uuid(),
  selection: z
    .array(
      z.strictObject({
        itemId: z.uuid(),
        unitId: hashSchema,
        sourceContentHash: hashSchema,
        expectedRevision: z.number().int().nonnegative()
      })
    )
    .min(1)
    .max(500)
    .refine((items) => new Set(items.map((item) => `${item.itemId}:${item.unitId}`)).size === items.length, {
      message: 'Select each chunk only once'
    }),
  action: KnowledgeChunkBatchActionSchema
})
export type KnowledgeChunkBatchInput = z.infer<typeof KnowledgeChunkBatchInputSchema>

export const KnowledgeChunkReviewActionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('discard') }),
  z.strictObject({ kind: z.literal('restore') }),
  z.strictObject({
    kind: z.literal('rebind'),
    targetUnitId: hashSchema,
    expectedTargetRevision: z.number().int().nonnegative()
  })
])
export const KnowledgeChunkReviewInputSchema = z.strictObject({
  baseId: z.uuid(),
  itemId: z.uuid(),
  governanceId: z.uuid(),
  expectedRevision: z.number().int().positive(),
  currentSourceContentHash: hashSchema.nullable(),
  action: KnowledgeChunkReviewActionSchema
})
export type KnowledgeChunkReviewInput = z.infer<typeof KnowledgeChunkReviewInputSchema>
export const KnowledgeChunkReviewListSchema = z.strictObject({
  currentSourceContentHash: hashSchema.nullable(),
  records: z.array(
    z.strictObject({
      id: z.uuid(),
      unitId: hashSchema,
      revision: z.number().int().positive(),
      sourceContentHash: hashSchema,
      charStart: z.number().int().nonnegative(),
      charEnd: z.number().int().positive(),
      originalText: z.string(),
      state: KnowledgeChunkGovernanceStateSchema,
      reason: z.enum(['source-unavailable', 'source-changed', 'chunk-changed']),
      retired: z.boolean()
    })
  )
})
export type KnowledgeChunkReviewList = z.infer<typeof KnowledgeChunkReviewListSchema>

/** Existing target decisions must never be silently merged by a rebind. */
export function hasKnowledgeChunkDecision(state: KnowledgeChunkGovernanceState): boolean {
  return state.excluded || state.labels.length > 0 || state.overrideText !== null
}

export const KnowledgeChunkHistoryQuerySchema = z.strictObject({
  beforeRevision: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(25).default(5)
})
export type KnowledgeChunkHistoryQuery = z.input<typeof KnowledgeChunkHistoryQuerySchema>
export const KnowledgeChunkHistoryPageSchema = z.strictObject({
  binding: z
    .strictObject({
      id: z.uuid(),
      unitId: hashSchema,
      sourceContentHash: hashSchema,
      originalText: z.string(),
      charStart: z.number().int().nonnegative(),
      charEnd: z.number().int().positive(),
      revision: z.number().int().positive(),
      retired: z.boolean()
    })
    .nullable(),
  items: z
    .array(
      z.strictObject({
        operation: z.enum(['edit', 'discard', 'rebind-away', 'rebind-from', 'restore-discard']),
        relatedGovernanceId: z.uuid().nullable(),
        revision: z.number().int().positive(),
        state: KnowledgeChunkGovernanceStateSchema,
        createdAt: z.number().int().nonnegative().max(8640000000000000)
      })
    )
    .max(25),
  nextBeforeRevision: z.number().int().positive().optional()
})
export type KnowledgeChunkHistoryPage = z.infer<typeof KnowledgeChunkHistoryPageSchema>
