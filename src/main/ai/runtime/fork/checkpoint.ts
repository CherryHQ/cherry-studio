import * as z from 'zod'

// Only routing is shared; each adapter owns the remaining native checkpoint fields.
const RuntimeForkCheckpointSchema = z.looseObject({ runtime: z.string().min(1) })

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
