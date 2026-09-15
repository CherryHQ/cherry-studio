import { type AgentSessionForkAvailability, isAgentSessionForkUnavailableReason } from '@shared/ai/agentSessionFork'

/** Project only availability; native checkpoint identifiers must never leave Main. */
export function getAgentSessionForkAvailability(value: unknown): AgentSessionForkAvailability {
  if (value == null) return { status: 'unavailable', reason: 'legacy_history' }
  if (typeof value !== 'object' || !('version' in value) || value.version !== 1) {
    return { status: 'unavailable', reason: 'unsupported_checkpoint' }
  }
  if ('status' in value && value.status === 'available') return { status: 'available' }
  const reason = 'reason' in value ? value.reason : undefined
  return {
    status: 'unavailable',
    reason: isAgentSessionForkUnavailableReason(reason) ? reason : 'unsupported_checkpoint'
  }
}

export class AgentSessionForkSourceError extends Error {
  constructor(readonly reason: 'source_missing' | 'source_changed') {
    super(reason)
    this.name = 'AgentSessionForkSourceError'
  }
}
