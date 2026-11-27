import type { AgentSessionEditFailureReason } from '@shared/ai/agentSessionEdit'

export class AgentSessionEditError extends Error {
  constructor(readonly reason: AgentSessionEditFailureReason) {
    super(reason)
    this.name = 'AgentSessionEditError'
  }
}
