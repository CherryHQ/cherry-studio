import * as z from 'zod'

export const MemoryScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('shared') }),
  z.object({ kind: z.literal('private'), agentId: z.string().min(1) })
])

export type MemoryScope = z.infer<typeof MemoryScopeSchema>

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
