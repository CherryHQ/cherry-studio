import type { RuntimeForkCheckpoint } from '@data/services/agentSessionFork'

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
