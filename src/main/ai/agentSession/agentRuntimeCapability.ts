import { randomUUID } from 'node:crypto'

export const AGENT_RUNTIME_CAPABILITY_HEADER = 'x-cherry-agent-runtime'
type RuntimeCapability = { sessionId: string; runtime: 'claude-code' | 'pi' }

// Tokens survive parking; the gateway checks current runtime liveness at resolution.
const capabilities = new Map<string, RuntimeCapability>()
const sessions = new Map<string, string>()

export function registerRuntimeCapability(sessionId: string, runtime: RuntimeCapability['runtime']): string {
  const existing = sessions.get(sessionId)
  if (existing) return existing
  const token = randomUUID()
  capabilities.set(token, { sessionId, runtime })
  sessions.set(sessionId, token)
  return token
}

export function lookupRuntimeCapability(token: string): RuntimeCapability | undefined {
  return capabilities.get(token)
}

export function resetRuntimeCapabilities(): void {
  capabilities.clear()
  sessions.clear()
}
