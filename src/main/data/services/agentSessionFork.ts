import * as z from 'zod'

import { AGENT_SESSION_FORK_UNAVAILABLE_REASONS, type AgentSessionForkAvailability } from '@shared/ai/agentSessionFork'

// Main-only persisted state, shared by the data projection and runtime validation.
const identity = { runtimeSessionId: z.string().min(1) }
export const RuntimeForkCheckpointSchema = z.discriminatedUnion('runtime', [
  z.strictObject({ runtime: z.literal('pi'), ...identity, leafId: z.string().min(1) }),
  z.strictObject({
    runtime: z.literal('claude-code'),
    ...identity,
    messageUuid: z.string().uuid(),
    configDir: z.string().min(1),
    sourceCwd: z.string().min(1),
    prefixBytes: z.number().int().positive(),
    prefixHash: z.string().regex(/^[a-f0-9]{64}$/)
  }),
  z.strictObject({
    runtime: z.literal('dsh'),
    ...identity,
    boundary: z.number().int().nonnegative(),
    prefixHash: z.string().regex(/^[a-f0-9]{64}$/)
  })
])

// Exclusions remain authoritative even when a native checkpoint format is no longer supported.
export const RuntimeForkMetadataSchema = z.object({
  version: z.literal(1),
  status: z.literal('available'),
  checkpoint: z.unknown(),
  excludedMessageIds: z.array(z.string()).optional()
})

export const RuntimeForkStateSchema = z.discriminatedUnion('status', [
  z.strictObject({
    version: z.literal(1),
    status: z.literal('available'),
    checkpoint: RuntimeForkCheckpointSchema,
    excludedMessageIds: z.array(z.string()).optional()
  }),
  z.strictObject({
    version: z.literal(1),
    status: z.literal('unavailable'),
    reason: z.enum(AGENT_SESSION_FORK_UNAVAILABLE_REASONS)
  })
])

export type RuntimeForkCheckpoint = z.infer<typeof RuntimeForkCheckpointSchema>
export type RuntimeForkState = z.infer<typeof RuntimeForkStateSchema>

/** Project only availability; native checkpoint identifiers must never leave Main. */
export function getAgentSessionForkAvailability(value: unknown): AgentSessionForkAvailability {
  if (value == null) return { status: 'unavailable', reason: 'legacy_history' }
  const parsed = RuntimeForkStateSchema.safeParse(value)
  if (!parsed.success) {
    return { status: 'unavailable', reason: 'unsupported_checkpoint' }
  }
  return parsed.data.status === 'available'
    ? { status: 'available' }
    : { status: 'unavailable', reason: parsed.data.reason }
}

export class AgentSessionForkSourceError extends Error {
  constructor(readonly reason: 'source_missing' | 'source_changed') {
    super(reason)
    this.name = 'AgentSessionForkSourceError'
  }
}
