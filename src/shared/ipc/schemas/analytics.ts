import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * Product analytics event catalog — the only events the generic analytics route accepts.
 * Fields are camelCase on the wire and snake_case in PostHog; values are enums, numbers, booleans, or random ids,
 * never user text, names, paths, or URLs. Subscription insights keep their own contract in `cherryCloud.ts`.
 */

const flowIdSchema = z.uuid()
const durationMsSchema = z.number().int().nonnegative()

export const analyticsModelSourceSchema = z.enum(['cherry_free', 'cherry_cloud', 'cherryin', 'own_key'])
export type AnalyticsModelSource = z.infer<typeof analyticsModelSourceSchema>

// Preset identifiers only (built-in mini app ids, provider ids, data-ui tokens); never user-entered names.
export const presetIdSchema = z.string().regex(/^[a-z0-9][a-z0-9:._-]{0,119}$/)

const featureSchema = z.enum([
  'translate',
  'paintings',
  'mini_app',
  'code',
  'quick_assistant',
  'selection',
  'knowledge',
  'notes',
  'screenshot',
  'voice',
  'mcp',
  'skills',
  'scheduled_tasks',
  'channels',
  'provider'
])

/** One core action of a feature; `target` names a preset (mini app, provider, CLI tool, channel type, built-in translate language), else omitted. */
export const featureUsedEventSchema = z.strictObject({
  event: z.literal('feature_used'),
  feature: featureSchema,
  action: z.enum([
    'translated',
    'image_generated',
    'opened',
    'asked',
    'cli_launched',
    'action_used',
    'base_created',
    'items_added',
    'searched',
    'note_created',
    'captured',
    'dictation_used',
    'server_added',
    'skill_installed',
    'task_created',
    'channel_connected',
    'provider_configured'
  ]),
  status: z.enum(['success', 'error']).optional(),
  modelSource: analyticsModelSourceSchema.optional(),
  trigger: z.enum(['page', 'selection', 'quick_assistant', 'shortcut', 'tray', 'menu', 'other']).optional(),
  target: presetIdSchema.optional(),
  count: z.number().int().nonnegative().optional(),
  durationMs: durationMsSchema.optional()
})
export type FeatureUsedEvent = z.infer<typeof featureUsedEventSchema>

export const analyticsPageSchema = z.enum([
  'chat',
  'agents',
  'paintings',
  'translate',
  'knowledge',
  'notes',
  'files',
  'code',
  'browser',
  'mini_app',
  'launchpad',
  'marketplace',
  'scheduled_tasks',
  'release_notes',
  'settings',
  'webview',
  'quick_assistant',
  'selection',
  'other'
])
export type AnalyticsPage = z.infer<typeof analyticsPageSchema>

/** Usage-behavior events stay off unless the build enables them (pending the privacy policy review). */
export const BEHAVIOR_ANALYTICS_EVENTS = [
  'page_viewed',
  'ui_clicked',
  'command_executed',
  'setting_changed',
  'settings_snapshot',
  'chat_branch_used',
  'chat_branch_snapshot',
  'message_action_used'
] as const

export const chatBranchSourceSchema = z.enum(['regenerate', 'edit', 'manual', 'mention'])
export type ChatBranchSource = z.infer<typeof chatBranchSourceSchema>

const onboardingStepSchema = z.enum(['welcome', 'provider', 'select_model'])
const onboardingOptionSchema = z.enum(['cherryin_login', 'cherry_cloud_login', 'other_provider', 'skip'])
export type OnboardingAnalyticsOption = z.infer<typeof onboardingOptionSchema>

/** Events produced by renderer windows; main validates them against this union. */
export const rendererAnalyticsEventSchema = z.discriminatedUnion('event', [
  z.strictObject({ event: z.literal('onboarding_option_selected'), option: onboardingOptionSchema }),
  z.strictObject({
    event: z.literal('onboarding_step_viewed'),
    step: z.enum(['provider', 'select_model']),
    fromStep: onboardingStepSchema
  }),
  z.strictObject({
    event: z.literal('onboarding_completed'),
    status: z.enum(['completed', 'skipped']),
    path: z.enum(['cherryin_login', 'cherry_cloud', 'custom_provider', 'skip']),
    durationMs: durationMsSchema.optional()
  }),
  z.strictObject({ event: z.literal('cherryin_entry_view'), signedIn: z.boolean() }),
  z.strictObject({
    event: z.literal('cherryin_sign_in_result'),
    source: z.enum(['onboarding', 'provider_settings']),
    result: z.enum(['success', 'failed', 'cancelled', 'no_model']),
    durationMs: durationMsSchema
  }),
  z.strictObject({
    event: z.literal('cherryin_topup_clicked'),
    source: z.enum(['provider_settings']),
    flowId: flowIdSchema
  }),
  z.strictObject({ event: z.literal('cherryin_balance_increased'), flowId: flowIdSchema }),
  featureUsedEventSchema,
  z.strictObject({
    event: z.literal('page_viewed'),
    page: analyticsPageSchema,
    previousPage: analyticsPageSchema.optional(),
    // Built-in mini app id or settings section; omitted for anything user-defined.
    subpage: presetIdSchema.optional(),
    durationMs: durationMsSchema,
    activeMs: durationMsSchema,
    endReason: z.enum(['navigate', 'tab_switch', 'tab_close', 'window_hidden', 'app_quit', 'idle_timeout']),
    capped: z.boolean()
  }),
  z.strictObject({
    event: z.literal('ui_clicked'),
    // The control's static data-analytics name, else the nearest static data-ui token; 'unlabeled' when neither exists.
    ui: presetIdSchema,
    page: analyticsPageSchema,
    element: z.enum(['button', 'link', 'menuitem', 'tab', 'checkbox', 'switch', 'option', 'input', 'other']),
    input: z.enum(['pointer', 'keyboard'])
  }),
  z.strictObject({
    event: z.literal('command_executed'),
    command: presetIdSchema,
    source: z.enum(['shortcut', 'menu', 'palette', 'other'])
  }),
  // `source` is set only when a branch is created.
  z.strictObject({
    event: z.literal('chat_branch_used'),
    action: z.enum(['created', 'switched', 'deleted', 'panel_opened']),
    source: chatBranchSourceSchema.optional()
  }),
  // Static message toolbar or menu action id, e.g. 'copy' or 'export.markdown'.
  z.strictObject({ event: z.literal('message_action_used'), action: presetIdSchema })
])
export type RendererAnalyticsEvent = z.infer<typeof rendererAnalyticsEventSchema>

/** Events produced inside the main process; typed only, since they never cross IPC. */
export type MainAnalyticsEvent =
  | { event: 'app_opened'; onboardingStatus: 'pending' | 'completed' | 'skipped' }
  | { event: 'agent_session_created'; agentKind: 'builtin' | 'custom' }
  | {
      event: 'agent_turn_finished'
      status: 'success' | 'error' | 'stopped'
      trigger: 'user' | 'headless'
      agentKind: 'builtin' | 'custom'
      modelSource: AnalyticsModelSource
      durationMs: number
      toolCallCount: number
    }
  | { event: 'agent_created'; source: 'manual' | 'assistant_tool' }
  | { event: 'cherryin_quota_error'; composer: 'chat' | 'agent' }
  | {
      event: 'chat_turn_finished'
      status: 'success' | 'error' | 'stopped'
      modelSource: AnalyticsModelSource
      durationMs: number
      usedWebSearch: boolean
      usedKnowledge: boolean
      mcpToolCount: number
      attachmentCount: number
    }
  // Values are booleans, numbers, or a catalogued fixed option; free-text settings report the key alone.
  | { event: 'setting_changed'; key: string; value?: boolean | number | string }
  // One property per catalogued setting, keyed `setting:<preference key>`; free-text settings report set or not.
  | ({ event: 'settings_snapshot' } & Record<`setting:${string}`, boolean | number | string>)
  | { event: 'chat_branch_snapshot'; topicCount: number; branchedTopicCount: number; branchCount: number }
  | FeatureUsedEvent

export type ProductAnalyticsEvent = RendererAnalyticsEvent | MainAnalyticsEvent

export const analyticsRequestSchemas = {
  'analytics.track': defineRoute({ input: rendererAnalyticsEventSchema, output: z.void() })
}
