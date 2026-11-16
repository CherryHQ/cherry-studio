import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { isProtectedBuiltinAgentRole } from '@shared/ai/builtinAgent'
import { CHERRY_CLOUD_PROVIDER_ID, CHERRYAI_PROVIDER_ID } from '@shared/data/presets/cherryai'
import type { AnalyticsModelSource, MainAnalyticsEvent } from '@shared/ipc/schemas/analytics'
import { SystemProviderIds } from '@shared/utils/systemProviderId'

/** Main-process product events; telemetry never throws into its caller. */
export function trackMainProductEvent(event: MainAnalyticsEvent): void {
  try {
    application.get('AnalyticsService').trackProductEvent(event)
  } catch {
    // Analytics is optional infrastructure for every caller.
  }
}

export function analyticsModelSource(providerId: string): AnalyticsModelSource {
  if (providerId === CHERRYAI_PROVIDER_ID) return 'cherry_free'
  if (providerId === CHERRY_CLOUD_PROVIDER_ID) return 'cherry_cloud'
  if (providerId === SystemProviderIds.cherryin) return 'cherryin'
  return 'own_key'
}

export function analyticsAgentKind(agentId: string): 'builtin' | 'custom' {
  return isProtectedBuiltinAgentRole(agentService.getAgent(agentId)?.configuration?.builtin_role) ? 'builtin' : 'custom'
}

/** For user-started conversation sessions only; background and seeded sessions stay silent. */
export function trackAgentSessionCreated(agentId: string): void {
  try {
    trackMainProductEvent({ event: 'agent_session_created', agentKind: analyticsAgentKind(agentId) })
  } catch {
    // Reading the agent must not fail session creation.
  }
}
