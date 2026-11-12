import type { RuntimeForkCheckpoint } from '@data/services/agentSessionForkContract'

export interface RuntimeForkInput {
  sourceSessionId: string
  sourceBackendId?: string
  checkpoint: RuntimeForkCheckpoint
  checkpoints: RuntimeForkCheckpoint[]
  targetSessionId: string
  targetCwd: string
  artifactDirectory: string
  signal: AbortSignal
  recordNativePreparation?(contextId: string): Promise<void>
}

export interface RuntimeForkResult {
  contextId?: string
  resumeToken: string
  checkpoints: RuntimeForkCheckpoint[]
  publish: Array<{ source: string; target: string }>
  validatePublication?(signal: AbortSignal): Promise<void>
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
