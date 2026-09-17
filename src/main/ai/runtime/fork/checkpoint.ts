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

export interface RuntimeForkInput {
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
