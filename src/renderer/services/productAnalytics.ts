import { dataApiService } from '@renderer/data/DataApiService'
import { ipcApi } from '@renderer/ipc'
import { buildAgentSessionTopicId } from '@shared/ai/agentSessionTopic'
import { isProtectedBuiltinAgentRole } from '@shared/ai/builtinAgent'
import type { Model } from '@shared/data/types/model'
import type { RendererAnalyticsEvent } from '@shared/ipc/schemas/analytics'
import { ANALYTICS_PRESET_ID_PATTERN, analyticsModelSource } from '@shared/utils/analyticsModelSource'
import type { ErrorCategory } from '@shared/utils/errorCategory'
import { isSystemProviderId } from '@shared/utils/systemProviderId'

/** Fire-and-forget; main enforces consent and the event catalog. Never throws into its caller. */
export function trackProductEvent(event: RendererAnalyticsEvent): void {
  try {
    void ipcApi.request('analytics.track', event).catch(() => undefined)
  } catch {
    // A missing bridge must not break the feature that reported.
  }
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

type MiniAppOpenTrigger = 'launchpad' | 'page' | 'sidebar' | 'split'
const miniAppOpenTriggers = new Map<string, MiniAppOpenTrigger>()

/** Entry points name how a mini app is being opened; the runtime takes it once when it creates the app. */
export function markMiniAppOpenTrigger(appId: string, trigger: MiniAppOpenTrigger): void {
  miniAppOpenTriggers.set(appId, trigger)
}

export function takeMiniAppOpenTrigger(appId: string): MiniAppOpenTrigger | 'other' {
  const trigger = miniAppOpenTriggers.get(appId)
  miniAppOpenTriggers.delete(appId)
  return trigger ?? 'other'
}

const AGENT_SESSION_TOPIC_PREFIX = buildAgentSessionTopicId('')

/** Agent session conversations share chat components; this tells their events apart. */
export function analyticsSurface(topicId: string | undefined): 'chat' | 'agent' {
  return topicId?.startsWith(AGENT_SESSION_TOPIC_PREFIX) ? 'agent' : 'chat'
}

type ChatErrorAction = Extract<RendererAnalyticsEvent, { event: 'chat_error_action' }>['action']

export function trackChatErrorAction(
  action: ChatErrorAction,
  reason: ErrorCategory,
  topicId: string | undefined
): void {
  trackProductEvent({ event: 'chat_error_action', action, reason, surface: analyticsSurface(topicId) })
}

/** A model the user picked in a composer; only built-in providers are named. */
export function trackModelSelected(surface: 'chat' | 'agent', models: readonly Model[]): void {
  const [first] = models
  if (!first) return
  trackProductEvent({
    event: 'chat_model_selected',
    surface,
    modelSource: analyticsModelSource(first.providerId),
    ...(isSystemProviderId(first.providerId) && { target: first.providerId }),
    ...(models.length > 1 && { count: models.length })
  })
}

/** A user-started API check; `errorReason` absent means it passed. */
export function trackProviderCheck(options: {
  surface: 'settings' | 'setup'
  providerId: string
  keyCount: number
  errorReason?: ErrorCategory
}): void {
  const { surface, providerId, keyCount, errorReason } = options
  trackProductEvent({
    event: 'provider_check_result',
    status: errorReason ? 'failed' : 'passed',
    surface,
    ...(errorReason && { errorReason }),
    keyCount,
    ...(isSystemProviderId(providerId) && { target: providerId })
  })
}

/** `presetId` is reported only when it is a static library id. */
export function trackAssistantCreated(source: 'blank' | 'library' | 'import' | 'duplicate', presetId?: string): void {
  const isPreset = presetId !== undefined && ANALYTICS_PRESET_ID_PATTERN.test(presetId)
  trackProductEvent({ event: 'assistant_created', source, ...(isPreset && { target: presetId }) })
}

type CodeBlockAction = Extract<RendererAnalyticsEvent, { event: 'code_block_action' }>['action']

/** Pass `language` only when it has a built-in special view, so free-form fence labels never leave. */
export function trackCodeBlockAction(action: CodeBlockAction, specialViewLanguage?: string): void {
  trackProductEvent({
    event: 'code_block_action',
    action,
    ...(specialViewLanguage && { language: specialViewLanguage })
  })
}
