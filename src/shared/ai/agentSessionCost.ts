import * as z from 'zod'

export const AgentSessionCostSnapshotSchema = z.strictObject({
  nativeSessionId: z.string().min(1),
  reportedAt: z.number().nonnegative(),
  cost: z
    .strictObject({
      amount: z.number().nonnegative(),
      currency: z.string().regex(/^[A-Z]{3}$/)
    })
    .nullable()
})

/** A cumulative native-session snapshot, never an invocation cost to add to the usage ledger. */
export type AgentSessionCostSnapshot = z.infer<typeof AgentSessionCostSnapshotSchema>

export const AGENT_SESSION_COST_CACHE_KEY = (sessionId: string) => `agent.session.cost.${sessionId}` as const
