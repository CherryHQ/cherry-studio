import * as z from 'zod'

// Main-only native locations. Availability is checked against SDK history on demand.
const identity = { runtimeSessionId: z.string().min(1) }
export const RuntimeForkCheckpointSchema = z.discriminatedUnion('runtime', [
  z.strictObject({ runtime: z.literal('pi'), ...identity, leafId: z.string().min(1) }),
  z.strictObject({
    runtime: z.literal('claude-code'),
    ...identity,
    messageUuid: z.string().uuid(),
    configDir: z.string().min(1)
  }),
  z.strictObject({
    runtime: z.literal('dsh'),
    ...identity,
    boundary: z.number().int().nonnegative()
  })
])

export const RuntimeForkAnchorSchema = z.strictObject({
  checkpoint: RuntimeForkCheckpointSchema,
  excludedMessageIds: z.array(z.string()).optional()
})

export type RuntimeForkCheckpoint = z.infer<typeof RuntimeForkCheckpointSchema>
export type RuntimeForkAnchor = z.infer<typeof RuntimeForkAnchorSchema>

export class AgentSessionForkSourceError extends Error {
  constructor(readonly reason: 'source_missing' | 'source_changed') {
    super(reason)
    this.name = 'AgentSessionForkSourceError'
  }
}
