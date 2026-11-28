export type AgentSessionRuntimeControls = {
  generation: string
  compact: boolean
  compactWithInstructions?: true
  durableFollowUp: boolean
  pendingSteerIds?: readonly string[]
  delivery?: { inputId: string; status: 'accepted' | 'queued' | 'unknown' }
}

export const AGENT_SESSION_RUNTIME_CONTROLS_CACHE_KEY = (sessionId: string) =>
  `agent.session.runtime_controls.${sessionId}` as const
