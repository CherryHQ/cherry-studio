import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { classifyNetworkError } from '@main/utils/networkError'
import { isDataCollectionConsented } from '@main/utils/privacyConsent'
import { isProtectedBuiltinAgentRole } from '@shared/ai/builtinAgent'
import {
  AGENT_MUTABLE_FIELDS,
  AgentConfigurationSchema,
  type AgentEntity,
  type UpdateAgentDto
} from '@shared/data/api/schemas/agents'
import type { ProductAnalyticsEvent, TransferFailureReason } from '@shared/ipc/schemas/analytics'
import type { DoctorFixRequest, DoctorFixResult, DoctorRunResult, DoctorRunTier } from '@shared/types/doctor'

export { analyticsModelSource } from '@shared/utils/analyticsModelSource'

/** Whether data collection is on under the current policy right now; aggregates count only such activity. */
export function isProductDataCollectionConsented(): boolean {
  try {
    const preferences = application.get('PreferenceService')
    return isDataCollectionConsented(
      preferences.get('app.privacy.data_collection.enabled'),
      preferences.get('app.privacy.policy_version')
    )
  } catch {
    return false
  }
}

/** Main-process product events; telemetry never throws into its caller. */
export function trackMainProductEvent(event: ProductAnalyticsEvent): void {
  try {
    application.get('AnalyticsService').trackProductEvent(event)
  } catch {
    // Analytics is optional infrastructure for every caller.
  }
}

/** Names a failed upload or download by kind only, since its message carries the URL. */
export function transferFailureReason(error: unknown): TransferFailureReason {
  const failure = error as {
    code?: unknown
    status?: unknown
    statusCode?: unknown
    $metadata?: { httpStatusCode?: unknown }
  } | null
  if (failure?.code === 'ENOSPC') return 'disk_full'
  // WebDAV sets `status`, electron-updater `statusCode`, and the S3 SDK `$metadata.httpStatusCode`.
  const status = [failure?.status, failure?.statusCode, failure?.$metadata?.httpStatusCode].find(
    (value): value is number => typeof value === 'number'
  )
  if (status === 401 || status === 403) return 'auth'
  // 408 is a 4xx but a timeout, not a settings problem.
  if (status === 408) return 'timeout'
  const { kind } = classifyNetworkError(error, status)
  // Other 4xx answers (missing path or bucket, conflict) point at the user's settings.
  if (kind === 'http_client') return 'config'
  if (kind === 'http_server') return 'server'
  if (kind === 'timeout') return 'timeout'
  return kind === 'unknown' ? 'other' : 'network'
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

/** One event per item type, so files, URLs, notes, and folders count separately. */
export function trackKnowledgeItemsAdded(types: readonly string[], origin: 'ui' | 'agent_tool'): void {
  const counts = new Map<string, number>()
  for (const type of types) counts.set(type, (counts.get(type) ?? 0) + 1)
  for (const [target, count] of counts) {
    trackMainProductEvent({ event: 'feature_used', feature: 'knowledge', action: 'items_added', target, count, origin })
  }
}

/** Reports how a Doctor run ended and how many checks failed or warned; never the findings. */
export async function reportDiagnosticsRun(
  tier: DoctorRunTier,
  origin: 'ui' | 'agent_tool',
  run: () => Promise<DoctorRunResult>
): Promise<DoctorRunResult> {
  try {
    const result = await run()
    if (result.status === 'completed') {
      const { fail, warn } = result.report.summary
      trackMainProductEvent({
        event: 'diagnostics_run',
        tier,
        status: 'completed',
        failCount: fail,
        warnCount: warn,
        origin
      })
    } else if (result.status === 'canceled') {
      trackMainProductEvent({ event: 'diagnostics_run', tier, status: 'canceled', origin })
    }
    return result
  } catch (error) {
    trackMainProductEvent({ event: 'diagnostics_run', tier, status: 'failed', origin })
    throw error
  }
}

export async function reportDiagnosticsFix(
  request: DoctorFixRequest,
  origin: 'ui' | 'agent_tool',
  fix: () => Promise<DoctorFixResult>
): Promise<DoctorFixResult> {
  const track = (result: 'fixed' | 'requires_relaunch' | 'failed' | 'stale') =>
    trackMainProductEvent({ event: 'diagnostics_fix', check: request.checkId, fix: request.fixId, result, origin })
  try {
    const result = await fix()
    track(result.status)
    return result
  } catch (error) {
    track('failed')
    throw error
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
