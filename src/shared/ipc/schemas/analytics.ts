import * as z from 'zod'

import { type AiFailureReason, aiFailureReasonSchema } from '@cherrystudio/remote-protocol/failure'
import type { ScheduleKind } from '@shared/ai/scheduleTrigger'
import type { AgentPermissionMode, AgentType } from '@shared/data/api/schemas/agents'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'
import type { DoctorCheckId, DoctorRunTier } from '@shared/types/doctor'
import { ANALYTICS_PRESET_ID_PATTERN } from '@shared/utils/analyticsModelSource'
import { ERROR_CATEGORIES } from '@shared/utils/errorCategory'

import { defineRoute } from '../define'
import type { HeartbeatRunResult } from './ai'

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
export const presetIdSchema = z.string().regex(ANALYTICS_PRESET_ID_PATTERN)

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
  'channels',
  'provider'
])

/** Failure reasons outside AI work (knowledge indexing, PDF translation, conversation import). */
export const featureErrorReasonSchema = z.enum([
  'empty_indexable_text',
  'indexing_interrupted',
  'dependency_missing',
  'dependency_outdated',
  'ocr_required',
  'persist_failed',
  'unsupported_format',
  'invalid_format',
  'other'
])
export type FeatureErrorReason = z.infer<typeof featureErrorReasonSchema>

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
    'channel_connected',
    'provider_configured',
    'skill_enabled',
    'skill_disabled',
    'skill_uninstalled',
    'server_connected',
    'channel_disconnected',
    'channel_deleted',
    'item_processed',
    'document_translated',
    'ocr_used',
    'image_edited',
    'template_used',
    'read_aloud',
    'app_installed',
    'app_pinned',
    'app_added',
    'toolbar_shown',
    'ai_titled',
    'exported'
  ]),
  status: z.enum(['success', 'error', 'cancelled']).optional(),
  modelSource: analyticsModelSourceSchema.optional(),
  trigger: z
    .enum([
      'page',
      'selection',
      'quick_assistant',
      'shortcut',
      'tray',
      'menu',
      'auto',
      'chat',
      'agent',
      'launchpad',
      'sidebar',
      'split',
      'other'
    ])
    .optional(),
  target: presetIdSchema.optional(),
  count: z.number().int().nonnegative().optional(),
  durationMs: durationMsSchema.optional(),
  errorReason: z.union([aiFailureReasonSchema, featureErrorReasonSchema]).optional(),
  // Where a skill came from; `origin` tells Cherry tool calls apart from the UI.
  source: z.enum(['marketplace', 'zip', 'local', 'system']).optional(),
  origin: z.enum(['ui', 'agent_tool']).optional()
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
  'message_action_used',
  'chat_error_action',
  'chat_model_selected',
  'topic_action_used',
  'assistant_snapshot',
  'quick_panel_used',
  'code_block_action',
  'agent_setting_changed',
  'agent_snapshot',
  'agent_session_action',
  'tool_approval',
  'agent_context_event',
  'scheduled_task_snapshot',
  'translate_history_used',
  'global_search_used',
  'announcement_action',
  'window_opened'
] as const

/** Where an Agent was created from; renderer callers attach it to the create command. */
export const agentCreateAnalyticsSchema = z.strictObject({
  entry: z.enum(['dialog', 'library', 'selector', 'marketplace']),
  target: presetIdSchema.optional()
})
export type AgentCreateAnalytics = z.infer<typeof agentCreateAnalyticsSchema>

/** Who started an Agent turn; 'user' is a person sending from the desktop app. */
export type AgentTurnSource =
  | 'user'
  | 'phone'
  | 'scheduled_task'
  | 'heartbeat'
  | 'channel'
  | 'delivery'
  | 'doctor'
  | 'autonomous'
  | 'headless'

/** Why a scheduled run stood down before reaching the Agent. */
export type ScheduledTaskSkipReason = 'disabled' | 'capability' | 'untrusted_path' | 'no_file' | 'session_busy'

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
  z.strictObject({ event: z.literal('agent_session_created'), agentKind: z.enum(['builtin', 'custom']) }),
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
  z.strictObject({
    event: z.literal('message_action_used'),
    action: presetIdSchema,
    surface: z.enum(['chat', 'agent']).optional()
  }),
  // What the user did with a failed reply; `reason` is the classified error category.
  z.strictObject({
    event: z.literal('chat_error_action'),
    action: z.enum(['retry', 'switch_model', 'trim_context', 'open_settings', 'billing', 'mcp', 'detail', 'dismiss']),
    reason: z.enum(ERROR_CATEGORIES),
    surface: z.enum(['chat', 'agent'])
  }),
  // `target` is a built-in provider id; `count` is set for a multi-model mention pick.
  z.strictObject({
    event: z.literal('chat_model_selected'),
    surface: z.enum(['chat', 'agent', 'mention']),
    modelSource: analyticsModelSourceSchema,
    target: presetIdSchema.optional(),
    count: z.number().int().nonnegative().optional()
  }),
  // Static topic menu action id, e.g. 'topic.export.markdown' or 'topic.unpin'.
  z.strictObject({ event: z.literal('topic_action_used'), action: presetIdSchema }),
  z.strictObject({
    event: z.literal('provider_check_result'),
    status: z.enum(['passed', 'failed']),
    surface: z.enum(['settings', 'setup']),
    errorReason: z.enum(ERROR_CATEGORIES).optional(),
    keyCount: z.number().int().nonnegative(),
    target: presetIdSchema.optional()
  }),
  // `target` is the assistant library preset id.
  z.strictObject({
    event: z.literal('assistant_created'),
    source: z.enum(['blank', 'library', 'import', 'duplicate']),
    target: presetIdSchema.optional()
  }),
  z.strictObject({
    event: z.literal('quick_panel_used'),
    panel: z.enum([
      'root',
      'knowledge_base',
      'quick_phrases',
      'mcp_status',
      'mcp_prompts',
      'mcp_resources',
      'notes',
      'other'
    ]),
    via: z.enum(['input', 'button']),
    result: z.enum(['selected', 'closed'])
  }),
  // `language` only for languages with a special view (e.g. html, mermaid).
  z.strictObject({
    event: z.literal('code_block_action'),
    action: z.enum(['preview_opened', 'open_external', 'download', 'copy', 'run', 'view_mode']),
    language: presetIdSchema.optional()
  }),
  // `count` is conversations imported; `errorReason` only on error.
  z.strictObject({
    event: z.literal('data_imported'),
    source: z.enum(['chatgpt', 'claude', 'browser']),
    status: z.enum(['success', 'error', 'cancelled']),
    errorReason: featureErrorReasonSchema.optional(),
    count: z.number().int().nonnegative().optional()
  }),
  z.strictObject({
    event: z.literal('translate_history_used'),
    action: z.enum(['opened', 'reused', 'cleared', 'starred'])
  }),
  // `group` is the static result group of the picked item.
  z.strictObject({
    event: z.literal('global_search_used'),
    found: z.boolean(),
    group: presetIdSchema.optional()
  }),
  z.strictObject({
    event: z.literal('announcement_action'),
    action: z.enum(['shown', 'expanded', 'link_clicked'])
  }),
  z.strictObject({
    event: z.literal('window_opened'),
    kind: z.enum(['tab_detached', 'topic', 'session'])
  })
])
export type RendererAnalyticsEvent = z.infer<typeof rendererAnalyticsEventSchema>

export type BackupAnalyticsTarget = 'file' | 'local_dir' | 'webdav' | 'nutstore' | 's3'

/** Events produced inside the main process; typed only, since they never cross IPC. */
export type MainAnalyticsEvent =
  | {
      event: 'app_opened'
      onboardingStatus: 'pending' | 'completed' | 'skipped'
      // 'upgraded' is any version change since the last recorded run.
      launch: 'first' | 'upgraded' | 'same'
      migratedFromV1: boolean
      lastExit: 'clean' | 'unclean' | 'unknown'
    }
  // Process start to the first main window being ready to show.
  | { event: 'app_started'; startupMs: number; launchToTray: boolean }
  // Once per local day while the app runs, so long-running sessions count as daily activity.
  | { event: 'app_active' }
  | { event: 'update_checked'; source: 'manual' | 'auto'; result: 'available' | 'not_available' | 'error' }
  | { event: 'update_downloaded'; status: 'success' | 'error' }
  | { event: 'update_install_started' }
  | {
      event: 'backup_run'
      target: BackupAnalyticsTarget
      mode: 'manual' | 'auto'
      status: 'success' | 'warning' | 'error'
      durationMs: number
    }
  // Restores and relocations end in a relaunch, so their results are reported on the next launch.
  | { event: 'restore_run'; target?: BackupAnalyticsTarget; status: 'completed' | 'failed' }
  | { event: 'data_relocation_run'; copy: boolean; status: 'completed' | 'failed' | 'abandoned' }
  | ({
      event: 'agent_turn_finished'
      status: 'success' | 'error' | 'stopped'
      trigger: AgentTurnSource
      agentKind: 'builtin' | 'custom'
      agentType: AgentType
      permissionMode: AgentPermissionMode
      modelSource: AnalyticsModelSource
      errorReason?: AiFailureReason
      durationMs: number
      toolCallCount: number
      toolErrorCount: number
      subagentCount: number
      skillCount: number
      // Per-tool counts keyed `tool:<built-in tool name>`; user MCP tools fold into `tool:mcp_custom`.
    } & Record<`tool:${string}`, number>)
  | {
      event: 'agent_created'
      source: 'manual' | 'assistant_tool'
      agentType: AgentType
      permissionMode: AgentPermissionMode
      entry: AgentCreateAnalytics['entry'] | 'assistant_tool'
      target?: string
    }
  | {
      event: 'agent_runtime_install'
      result: 'success' | 'error' | 'unsupported'
      error?: 'network' | 'integrity' | 'storage' | 'installation'
      retry: boolean
      // The download came from the fallback registry.
      fallback: boolean
      durationMs: number
    }
  // Values only for enum and boolean settings; names, instructions, env vars, and cron stay out.
  | { event: 'agent_setting_changed'; key: string; value?: boolean | string }
  | ({ event: 'agent_snapshot'; agentCount: number; heartbeatCount: number; withChannelCount: number } & Record<
      `type:${string}` | `permission:${string}` | `kind:${string}`,
      number
    >)
  | {
      event: 'agent_session_action'
      action: 'fork' | 'archive' | 'purge' | 'restore' | 'reuse'
      status: 'success' | 'error'
      count: number
    }
  | { event: 'remote_paired'; result: 'approved' | 'rejected' | 'expired' | 'error' }
  | {
      event: 'tool_approval'
      surface: 'agent' | 'chat'
      decision: 'approved' | 'denied' | 'always' | 'session' | 'aborted'
      // Built-in tool name, else 'mcp_custom' or 'other'.
      tool: string
      // Only for live approvals; a persisted chat card has no request time.
      waitMs?: number
    }
  | {
      event: 'agent_context_event'
      action: 'compacted' | 'steered' | 'heartbeat_run'
      trigger?: 'manual' | 'auto'
      result?: HeartbeatRunResult
    }
  // Schedule shape only; names, prompts, cron expressions, and workspace paths stay out.
  | {
      event: 'scheduled_task_changed'
      action: 'created' | 'updated' | 'paused' | 'resumed' | 'deleted'
      origin: 'ui' | 'agent_tool'
      frequency: ScheduleKind
      agentKind: 'builtin' | 'custom'
      hasWorkspace: boolean
      reuseSession: boolean
      channelCount: number
    }
  | {
      event: 'scheduled_task_run'
      kind: 'task' | 'heartbeat'
      result: 'success' | 'failed' | 'cancelled' | 'interrupted' | 'skipped'
      skipReason?: ScheduledTaskSkipReason
      run: 'scheduled' | 'manual'
      durationMs?: number
      channelCount: number
      // This failure made the circuit breaker pause the schedule.
      autoPaused?: boolean
    }
  | ({
      event: 'scheduled_task_snapshot'
      taskCount: number
      autoPausedCount: number
      reuseSessionCount: number
      withChannelTaskCount: number
      channelCount: number
      activeChannelCount: number
      connectedChannelCount: number
      // Channels subscribed to at least one task's results.
      resultChannelCount: number
    } & Record<`status:${string}` | `frequency:${string}` | `channel:${string}`, number>)
  | { event: 'cherryin_quota_error'; composer: 'chat' | 'agent' }
  | {
      event: 'account_sign_in_result'
      result: 'signed_in' | 'cancelled' | 'expired' | 'rejected' | 'failed'
    }
  | { event: 'account_signed_out'; reason: 'user' | 'expired' | 'revoked' | 'disabled' }
  | {
      event: 'diagnostics_run'
      tier: DoctorRunTier
      status: 'completed' | 'canceled' | 'failed'
      failCount?: number
      warnCount?: number
      origin: 'ui' | 'agent_tool'
    }
  | {
      event: 'diagnostics_fix'
      check: DoctorCheckId
      fix: string
      result: 'fixed' | 'requires_relaunch' | 'failed' | 'stale'
      origin: 'ui' | 'agent_tool'
    }
  | {
      event: 'chat_turn_finished'
      status: 'success' | 'error' | 'stopped'
      modelSource: AnalyticsModelSource
      // Built-in provider id only; user-created providers are never named.
      target?: string
      errorReason?: AiFailureReason
      origin: 'send' | 'regenerate' | 'retry' | 'steer' | 'continue'
      // Models answering the same send; each reply still reports its own event.
      modelCount: number
      durationMs: number
      firstTokenMs?: number
      reasoningEffort?: ReasoningEffortOption
      fastMode: boolean
      webSearchEnabled: boolean
      usedWebSearch: boolean
      knowledgeBaseCount: number
      usedKnowledge: boolean
      mcpToolCount: number
      attachmentCount: number
      imageCount: number
      // User messages sent as context in this request.
      depth: number
    }
  | {
      event: 'assistant_snapshot'
      assistantCount: number
      withPrompt: number
      withModel: number
      withTemperature: number
      withWebSearch: number
      withKnowledge: number
    }
  // Values are booleans, numbers, or a catalogued fixed option; free-text settings report the key alone.
  | { event: 'setting_changed'; key: string; value?: boolean | number | string }
  // One property per catalogued setting, keyed `setting:<preference key>`; free-text settings report set or not.
  | ({ event: 'settings_snapshot' } & Record<`setting:${string}`, boolean | number | string>)
  | { event: 'chat_branch_snapshot'; topicCount: number; branchedTopicCount: number; branchCount: number }
  | FeatureUsedEvent
  // Browser data imports run in main; conversation imports report from the renderer.
  | Extract<RendererAnalyticsEvent, { event: 'data_imported' }>

export type ProductAnalyticsEvent = RendererAnalyticsEvent | MainAnalyticsEvent

export const analyticsRequestSchemas = {
  'analytics.track': defineRoute({ input: rendererAnalyticsEventSchema, output: z.void() })
}
