import { AgentSessionForkUnavailableReasonSchema } from '@shared/ai/agentSessionFork'
import * as z from 'zod'

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
  z.strictObject({ runtime: z.literal('dsh'), ...identity, boundary: z.number().int().nonnegative() })
])

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
    reason: AgentSessionForkUnavailableReasonSchema
  })
])

export type RuntimeForkCheckpoint = z.infer<typeof RuntimeForkCheckpointSchema>
export type RuntimeForkState = z.infer<typeof RuntimeForkStateSchema>

export const FORK_CHECKPOINT_FAILED: RuntimeForkState = {
  version: 1,
  status: 'unavailable',
  reason: 'checkpoint_failed'
}
export const NOT_FORK_BOUNDARY: RuntimeForkState = {
  version: 1,
  status: 'unavailable',
  reason: 'not_turn_boundary'
}

export interface RuntimeForkInput {
  snapshotEvents?: unknown[]
  sourceSessionId: string
  checkpoint: RuntimeForkCheckpoint
  checkpoints: RuntimeForkCheckpoint[]
  targetSessionId: string
  targetCwd: string
  artifactDirectory: string
  signal: AbortSignal
}

export interface RuntimeForkResult {
  resumeToken: string
  checkpoints: RuntimeForkCheckpoint[]
  publish: Array<{ source: string; target: string }>
}

export class AgentSessionForkError extends Error {
  constructor(
    readonly reason: string,
    message: string = reason
  ) {
    super(message)
    this.name = 'AgentSessionForkError'
  }
}
