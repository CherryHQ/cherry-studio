import * as z from 'zod'

export const KnowledgeChunkGovernanceStateSchema = z.strictObject({
  excluded: z.boolean(),
  labels: z.array(z.string().trim().min(1)).transform((labels) => [...new Set(labels)].sort()),
  overrideText: z.string().min(1).nullable()
})
export type KnowledgeChunkGovernanceState = z.infer<typeof KnowledgeChunkGovernanceStateSchema>

export const KnowledgeChunkGovernanceSourceSchema = z
  .strictObject({
    baseId: z.uuid(),
    itemId: z.uuid(),
    unitId: z.string().regex(/^[a-f0-9]{64}$/),
    sourceContentHash: z.string().regex(/^[a-f0-9]{64}$/),
    charStart: z.number().int().nonnegative(),
    charEnd: z.number().int().positive(),
    originalText: z.string().min(1)
  })
  .refine((value) => value.charEnd - value.charStart === value.originalText.length, {
    message: 'Original text must match the source offset range',
    path: ['charEnd']
  })
export type KnowledgeChunkGovernanceSource = z.infer<typeof KnowledgeChunkGovernanceSourceSchema>
