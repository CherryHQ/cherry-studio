import type { AiFailureReason } from '@cherrystudio/remote-protocol/failure'
import type { BuiltinAgentRole } from '@shared/ai/builtinAgent'
import type { ScheduleKind } from '@shared/ai/scheduleTrigger'
import type { AgentChannelType } from '@shared/data/api/schemas/agentChannels'
import type { AgentPermissionMode, AgentType } from '@shared/data/api/schemas/agents'
import type { HeartbeatRunResult } from '@shared/ipc/schemas/ai'
import type {
  AgentCreateAnalytics,
  AgentTurnSource,
  AnalyticsModelSource,
  BackupAnalyticsTarget,
  BackupSizeBucket,
  FeatureUsedEvent,
  RendererAnalyticsEvent,
  ScheduledTaskSkipReason,
  TransferFailureReason
} from '@shared/ipc/schemas/analytics'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'
import type { DoctorCheckId, DoctorRunTier } from '@shared/types/doctor'

/** Events produced inside the main process; typed only, since they never cross IPC. The renderer's own events
 * stay in the shared catalog that `analytics.track` validates. */
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
  | {
      event: 'update_downloaded'
      status: 'success' | 'error'
      errorReason?: Exclude<TransferFailureReason, 'config'> | 'checksum' | 'signature'
    }
  | { event: 'update_install_started' }
  // The installer reported an error after an install started.
  | { event: 'update_install_failed'; errorReason: Exclude<TransferFailureReason, 'config'> | 'checksum' | 'signature' }
  | {
      event: 'backup_run'
      target: BackupAnalyticsTarget
      mode: 'manual' | 'auto'
      status: 'success' | 'warning' | 'error'
      durationMs: number
      // `errorReason` only on error; `sizeBucket` (the archive) only when one was written.
      errorReason?: TransferFailureReason | 'too_large'
      sizeBucket?: BackupSizeBucket
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
      builtinRole?: BuiltinAgentRole
      hasWorkspace: boolean
      reuseSession: boolean
      channelCount: number
      // The schedule's random local id, to follow one task across days.
      taskId: string
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
      taskId: string
    }
  // One per channel chat a scheduled task's result or failure notice was sent to.
  | {
      event: 'scheduled_task_delivery'
      taskId: string
      channelType: AgentChannelType
      content: 'result' | 'failure_notice'
      status: 'success' | 'error'
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
