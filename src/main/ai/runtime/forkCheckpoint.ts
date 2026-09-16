import type { RuntimeForkCheckpoint, RuntimeForkState } from '@data/services/agentSessionFork'

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
