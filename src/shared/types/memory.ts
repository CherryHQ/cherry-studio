import * as z from 'zod'

export const MemoryScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('shared') }),
  z.object({ kind: z.literal('private'), agentId: z.string().min(1) })
])

export type MemoryScope = z.infer<typeof MemoryScopeSchema>

export const MemoryExtractionRangeSchema = z.object({
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('assistant'), topicId: z.string().min(1), responseId: z.string().min(1) }),
    z.object({
      kind: z.literal('agent'),
      sessionId: z.string().min(1),
      userMessageId: z.string().min(1),
      responseId: z.string().min(1)
    })
  ]),
  fromMessageId: z.string().min(1)
})

export const MemoryCandidateSchema = z.strictObject({
  text: z.string().trim().min(1).max(1000),
  subject: z.string().trim().min(1).max(200),
  scope: z.enum(['personal', 'project', 'customer', 'uncertain']),
  kind: z.enum(['preference', 'personal_fact', 'decision', 'constraint', 'experience', 'uncertain']),
  conditions: z.string().max(500),
  time: z.string().max(200),
  usefulness: z.string().trim().min(1).max(500),
  action: z.enum(['add', 'exists', 'conflict', 'insufficient', 'omit', 'out_of_scope']),
  reason: z.string().trim().min(1).max(500),
  evidence: z
    .array(
      z.strictObject({
        messageId: z.string().min(1),
        version: z.string().min(1),
        quote: z.string().min(1).max(2000)
      })
    )
    .min(1)
    .max(12),
  existing: z
    .array(
      z.strictObject({
        path: z.string().min(1),
        version: z.string().nullable(),
        quote: z.string().min(1).max(2000)
      })
    )
    .max(10)
})

export const MemoryExtractionPreviewSchema = z.object({
  mode: z.literal('preview'),
  saveBlocked: z.literal('forgetting_protection_required'),
  sourceVersion: z.string(),
  candidates: z.array(MemoryCandidateSchema),
  batches: z.array(z.object({ outcome: z.enum(['candidates', 'no_eligible', 'insufficient']), reason: z.string() })),
  modelId: z.string(),
  calls: z.number(),
  elapsedMs: z.number()
})

export type MemoryExtractionRange = z.infer<typeof MemoryExtractionRangeSchema>
export type MemoryCandidate = z.infer<typeof MemoryCandidateSchema>

const dreamingReason = z.enum(['model', 'budget', 'migration', 'conflict', 'backup', 'output', 'unavailable'])

export const MemoryDreamingStatusSchema = z.object({
  pending: z.boolean(),
  status: z.enum(['idle', 'queued', 'running', 'failed', 'cancelled']),
  reason: dreamingReason.optional(),
  lastRunAt: z.number().optional(),
  lastResult: z
    .object({
      outcome: z.enum(['completed', 'failed', 'cancelled']),
      finishedAt: z.number(),
      reason: dreamingReason.optional()
    })
    .optional()
})
