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
