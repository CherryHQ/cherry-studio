import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { isProtectedBuiltinAgentRole } from '@shared/ai/builtinAgent'
import {
  AGENT_MUTABLE_FIELDS,
  AgentConfigurationSchema,
  type AgentEntity,
  type UpdateAgentDto
} from '@shared/data/api/schemas/agents'
import type { ProductAnalyticsEvent } from '@shared/ipc/schemas/analytics'

export { analyticsModelSource } from '@shared/utils/analyticsModelSource'

/** Main-process product events; telemetry never throws into its caller. */
export function trackMainProductEvent(event: ProductAnalyticsEvent): void {
  try {
    application.get('AnalyticsService').trackProductEvent(event)
  } catch {
    // Analytics is optional infrastructure for every caller.
  }
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

const AGENT_CONFIGURATION_KEYS: ReadonlySet<string> = new Set(Object.keys(AgentConfigurationSchema.shape))
const AGENT_ENUM_CONFIGURATION_KEYS: ReadonlySet<string> = new Set([
  'permission_mode',
  'reasoning_effort',
  'service_tier',
  'scheduler_type'
])
const same = (left: unknown, right: unknown) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null)

/** One event per Agent setting the user actually changed; values only for enums and booleans. */
export function trackAgentSettingChanges(before: AgentEntity, after: AgentEntity, updates: UpdateAgentDto): void {
  for (const field of Object.keys(AGENT_MUTABLE_FIELDS) as (keyof typeof AGENT_MUTABLE_FIELDS)[]) {
    if (field === 'configuration' || updates[field] === undefined) continue
    if (!same(before[field], after[field])) trackMainProductEvent({ event: 'agent_setting_changed', key: field })
  }
  for (const key of Object.keys(updates.configuration ?? {})) {
    if (!AGENT_CONFIGURATION_KEYS.has(key)) continue
    const previous = before.configuration?.[key]
    const next = after.configuration?.[key]
    if (same(previous, next)) continue
    const value =
      typeof next === 'boolean' || (AGENT_ENUM_CONFIGURATION_KEYS.has(key) && typeof next === 'string')
        ? next
        : undefined
    trackMainProductEvent({
      event: 'agent_setting_changed',
      key: `configuration.${key}`,
      ...(value !== undefined && { value })
    })
  }
}

type AgentSessionAction = Extract<ProductAnalyticsEvent, { event: 'agent_session_action' }>['action']

/**
 * Reports a user-run session operation after it settles; the operation's own result passes through.
 * @param succeeded How many sessions the result shows were changed; a failure reports the requested count.
 */
export async function reportAgentSessionAction<T>(
  action: AgentSessionAction,
  count: number,
  run: () => Promise<T>,
  succeeded: (result: T) => number = () => count
): Promise<T> {
  let result: T
  try {
    result = await run()
  } catch (error) {
    trackMainProductEvent({ event: 'agent_session_action', action, status: 'error', count })
    throw error
  }
  trackMainProductEvent({ event: 'agent_session_action', action, status: 'success', count: succeeded(result) })
  return result
}
