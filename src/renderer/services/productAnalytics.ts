import { dataApiService } from '@renderer/data/DataApiService'
import { ipcApi } from '@renderer/ipc'
import { isProtectedBuiltinAgentRole } from '@shared/ai/builtinAgent'
import type { RendererAnalyticsEvent } from '@shared/ipc/schemas/analytics'

/** Fire-and-forget; main enforces consent and the event catalog. */
export function trackProductEvent(event: RendererAnalyticsEvent): void {
  void ipcApi.request('analytics.track', event).catch(() => undefined)
}

/** A conversation the user started with an Agent; built-in Agents count apart from custom ones. */
export async function trackAgentSessionCreated(agentId: string): Promise<void> {
  try {
    const agent = await dataApiService.get(`/agents/${agentId}`)
    const builtin = isProtectedBuiltinAgentRole(agent.configuration?.builtin_role)
    trackProductEvent({ event: 'agent_session_created', agentKind: builtin ? 'builtin' : 'custom' })
  } catch {
    // Analytics never affects session creation.
  }
}
