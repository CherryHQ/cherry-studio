import * as z from 'zod'

const tokens = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const LocalAgentTurnUsageSchema = z.strictObject({
  nativeSessionId: z.string().min(1),
  model: z.string().nullable(),
  reportedAt: z.number().nonnegative(),
  correlation: z.enum(['gateway', 'unknown']),
  usage: z.strictObject({
    inputTokens: tokens,
    outputTokens: tokens,
    totalTokens: tokens,
    noCacheTokens: tokens.optional(),
    cacheReadTokens: tokens.optional(),
    cacheWriteTokens: tokens.optional(),
    reasoningTokens: tokens.optional()
  })
})
export type LocalAgentTurnUsage = z.infer<typeof LocalAgentTurnUsageSchema>

export const LocalAgentUsageQuerySchema = z
  .strictObject({
    from: z.number().int().nonnegative(),
    to: z.number().int().nonnegative(),
    scope: z.enum(['turn', 'session-cost']).default('turn'),
    cursor: z.string().max(512).optional(),
    limit: z.number().int().positive().max(100).default(50)
  })
  .refine(({ from, to }) => to >= from && to - from <= 366 * 86400000, 'Invalid usage date range')
export type LocalAgentUsageQuery = z.infer<typeof LocalAgentUsageQuerySchema>
export interface LocalAgentUsageEntry {
  id: string
  sessionId: string | null
  sessionName: string | null
  agentName: string | null
  model: string | null
  reportedAt: number
  scope: 'turn' | 'legacy-turn' | 'session-cost'
  legacyTokens?: number | null
  summary: LocalAgentTurnUsage | null
  cost: { amount: number; currency: string } | null
}
export interface LocalAgentUsageResponse {
  items: LocalAgentUsageEntry[]
  nextCursor?: string
}
