import type { LanguageModelV3ToolApprovalRequest } from '@ai-sdk/provider'
import type { FinishReason } from 'ai'

import type {
  CompactThread,
  InputId,
  InputLookup,
  ProductInputState,
  LivePartInput,
  OperationResult,
  ThreadContextUsage,
  ThreadInput
} from '@cherrystudio/agent-runtime'
import type { AgentSessionContextRow } from '@data/db/schemas/agentSessionContext'
import type { AiUsageCredentialReceipt, SourceSnapshot } from '@data/services/AiUsageRecordService'
import type { RuntimeForkAnchor } from '@main/ai/runtime/fork'
import type { AgentSessionApiRetryInfo } from '@shared/ai/agentSessionApiRetry'
import type { AgentSessionBackgroundTasks } from '@shared/ai/agentSessionBackgroundTasks'
import type { AgentSessionCompactionAnchorData, AgentSessionCompactionTrigger } from '@shared/ai/agentSessionCompaction'
import type { AgentSessionCostSnapshot } from '@shared/ai/agentSessionCost'
import type { AgentSessionFollowup, AgentSessionFollowupChange } from '@shared/ai/agentSessionFollowups'
import type { AgentSessionSlashCommand } from '@shared/ai/agentSessionSlashCommands'
import type { AutonomousTurnOrigin } from '@shared/ai/agentSessionTurnOrigin'
import type { ExecutionId } from '@shared/ai/executionIdentity'
import type { LocalAgentNotice, LocalAgentRuntime, LocalAgentSessionInfo } from '@shared/ai/localAgent'
import type { LocalAgentTurnUsage } from '@shared/ai/localAgentUsage'
import type { ToolTerminalDelta } from '@shared/ai/messageProjection'
import type { AgentEntity, AgentPermissionMode } from '@shared/data/api/schemas/agents'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { AiUsagePricingSnapshot } from '@shared/data/types/aiUsageRecord'
import type {
  CherryUIMessage,
  CherryUIMessageChunk,
  CherryUIMessageMetadata,
  MessageSnapshot,
  MessageStats
} from '@shared/data/types/message'
import type { ServiceTierSelection } from '@shared/data/types/model'
import type { AgentTaskEventPartData } from '@shared/data/types/uiParts'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'

import type { LocalLaunchTarget } from '../agentSession/localContext'
import type { RuntimeForkInput, RuntimeForkResult } from './fork'
import type { RuntimeWorkspaceRelocation } from './workspaceRelocation'

export interface UnavailableNativeContext {
  status: 'native-context-unavailable'
  context: AgentSessionContextRow
  reason: string
}

export function unavailableNativeContext(context: AgentSessionContextRow, reason: string): UnavailableNativeContext {
  return { status: 'native-context-unavailable', context, reason }
}

/**
 * Agent-session usage has exactly one capture owner per runtime route.
 * Direct/external SDK routes emit per-assistant-message invocation records;
 * gateway routes are captured by the normal provider-call middleware.
 */
export type AgentSessionUsageCapture =
  | {
      owner: 'agent-sdk'
      credentialReceipt: AiUsageCredentialReceipt
      providerId: string
      providerName: string | null
      source: SourceSnapshot | null
      frozenModels: ReadonlyArray<{
        modelId: string
        apiModelId: string
        modelName: string | null
        aliases: readonly string[]
        pricingSnapshot: AiUsagePricingSnapshot | null
      }>
    }
  | { owner: 'provider-calls' }

export interface AgentRuntimeTraceContext {
  topicId: string
  traceId: string
  modelName?: string
  sessionId: string
  turnId: string
  rootSpanId: string
}

export interface AgentRuntimeConnectInput {
  sessionId: string
  agentId: string
  modelId: ExecutionId
  /** Canonical reasoning selection frozen for this connection's turn. */
  reasoningEffort?: ReasoningEffortOption
  /** Canonical provider request tier frozen for this connection's turn. */
  serviceTier?: ServiceTierSelection
  /** Per-turn composer knowledge selection; static Agent bindings still take precedence. */
  knowledgeBaseIds?: readonly string[]
  /** Whether this connection's turn requests Fast processing. */
  fastMode?: boolean
  resumeToken?: string
  /** Independent native identity for an edited first turn with no history to resume. */
  nativeSessionId?: string
  /** True when this connection's turn is headless: headless turns resolve against the agent
   *  default and ignore session model overrides, which decides which resolution a captured
   *  connection model is compared against for stale-capture pinning. */
  headless?: boolean
  localPermissionMode?: AgentPermissionMode
  /** Explicit channel policy for this turn, independent of the Agent's stored configuration. */
  permissionModeOverride?: AgentPermissionMode
  /** Product position captured before asynchronous connection work. */
  branchHead?: string
  trace?: AgentRuntimeTraceContext
  /**
   * Synchronous host hook fired when a pending steer is actually injected. The host uses this
   * before the SDK can issue its next provider request to associate the input with its active Run;
   * the later `steer-boundary` confirms placement without creating another execution.
   */
  onSteerInjected?: (inputIds: readonly string[]) => void
}

export interface LocalRuntimeConnectInput extends AgentRuntimeConnectInput {
  localTarget: LocalLaunchTarget
}

export interface AgentRuntimeUserInput {
  message: AgentSessionMessageEntity
  /** Model-only context; the original product message remains unchanged. */
  context?: CherryUIMessage['parts']
  /** True when this message arrived mid-turn (a steer) — the driver wraps it in a system-reminder
   *  so the model treats it as a redirect rather than a fresh prompt (invariant 7). */
  systemReminder?: boolean
  /** Product attributes retained by the session owner until ownership transfers. */
  headless?: boolean
  messageSnapshot?: MessageSnapshot
}

export type AgentRuntimeCommand = Pick<AgentRuntimeUserInput, 'message' | 'systemReminder' | 'context'>

export type AgentRuntimeInput = ThreadInput<AgentRuntimeCommand & { readonly inputId: InputId }>

/**
 * Runtime-neutral approval request. Drivers emit this instead of writing directly to a live
 * renderer stream: the host can append it to the current turn or persist an independent
 * interaction message when the requesting agent outlives that turn.
 */
export interface AgentRuntimeToolApprovalRequest {
  approvalId: string
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
  presentation: 'stream' | 'message'
  providerMetadata?: LanguageModelV3ToolApprovalRequest['providerMetadata']
}

export interface RuntimeMessageProjection {
  readonly legacy?: Readonly<Record<string, { messageId: string }>>
  contextId: string
  messages: readonly CherryUIMessage[]
  live: readonly string[]
  /** Display-only refreshes update existing owners without admitting historical sources into a new reply. */
  refresh?: readonly string[]
  /** Product input IDs of native user messages in `messages`; their answers belong to that input's reply. */
  inputs?: Readonly<Record<string, string>>
  replaces: Readonly<Record<string, string>>
  removed: readonly string[]
}

type RuntimeStreamControl =
  | Extract<CherryUIMessageChunk, { type: 'data-retry' | 'tool-input-available' }>
  | {
      type: 'message-metadata'
      messageMetadata: ({ stats: MessageStats; totalTokens?: number } | { localTurnUsage: LocalAgentTurnUsage }) & {
        [K in Exclude<keyof CherryUIMessageMetadata, 'stats' | 'totalTokens' | 'localTurnUsage'>]?: never
      }
    }

export type AgentControlChunk =
  | RuntimeStreamControl
  | { type: 'start' }
  | Extract<
      CherryUIMessageChunk,
      { type: 'tool-approval-request' | 'data-compaction-anchor' | 'data-agent-task-event' }
    >

export type AgentRuntimeEvent =
  | {
      type: 'message-projection'
      projection: RuntimeMessageProjection
      toolOwner?: { toolCallId: string; detached: boolean }
    }
  | (LivePartInput & { contextId: string })
  | { type: 'local-tool-terminal'; contextId: string; itemId: string; part: number; delta: ToolTerminalDelta }
  | { type: 'response-start'; responseId: string; messageId?: string }
  | RuntimeStreamControl
  | { type: 'tool-approval-request'; request: AgentRuntimeToolApprovalRequest }
  | { type: 'tool-approval-withdrawn'; contextId: string; toolCallId: string; approvalId: string }
  | {
      type: 'usage'
      invocation: {
        /** Globally unique, driver-namespaced invocation id used directly for idempotent persistence. */
        requestId: string
        /** Native identity shared with the response-start event that binds the product message. */
        responseId: string
        model: string
        /** Frozen when the provider invocation is first observed; never inferred later from host turn state. */
        messageAssociation: 'current-turn' | 'stateless'
        usage?: {
          inputTokens: number
          outputTokens: number
          totalTokens: number
          reasoningTokens?: number
          noCacheTokens?: number
          cacheReadTokens?: number
          cacheWriteTokens?: number
        }
        metrics?: {
          timeFirstTokenMs?: number
          timeCompletionMs?: number
          timeThinkingMs?: number
        }
      }
    }
  | { type: 'resume-token'; token: string }
  /** The stable input association identifies the owning Run, including a deferred placement. */
  | { type: 'run-checkpoint'; contextId: string; inputId: string; forkAnchor: RuntimeForkAnchor }
  /** `paused`: native evidence that the turn was aborted, such as a recorded user stop. */
  | {
      type: 'turn-complete'
      forkAnchor?: RuntimeForkAnchor
      status?: 'paused'
      finishReason?: FinishReason
    }
  /** Steered inputs join the current Run. A native follow-up can start a distinct Run. */
  | { type: 'steer-boundary'; inputIds: readonly string[] }
  | { type: 'run-started'; inputIds: readonly string[] }
  | { type: 'followup-queue'; queue: AgentSessionFollowup[]; restored?: true }
  | { type: 'input-state'; contextId: string; input: ProductInputState }
  | { type: 'compaction-start'; trigger?: AgentSessionCompactionTrigger }
  | { type: 'compaction-complete'; anchor?: AgentSessionCompactionAnchorData }
  | { type: 'compaction-error'; error: string; aborted?: boolean }
  /** The SDK is backing off before retrying a failed API request (`system/api_retry`). Ephemeral
   *  session status — the host surfaces it in the message stream and clears it when content resumes,
   *  the turn ends/errors/cancels, or the connection closes. Never persisted as conversation content. */
  | { type: 'api-retry'; retry: AgentSessionApiRetryInfo }
  | { type: 'local-turn-usage'; summary: LocalAgentTurnUsage }
  | { type: 'session-cost'; snapshot: AgentSessionCostSnapshot }
  | { type: 'context-usage'; result: OperationResult<ThreadContextUsage> }
  /** The SDK pushed a fresh slash-command catalog mid-session (`system / commands_changed`) — e.g.
   *  skills discovered as the agent works in a subdirectory. `supportedCommands()` is captured at
   *  init and never reflects this, so the host REPLACES its cached list from `commands`. */
  | { type: 'session-title'; title: string }
  | { type: 'notice'; notice: LocalAgentNotice }
  | { type: 'local-session-info'; info: LocalAgentSessionInfo }
  | { type: 'supported-commands'; commands: AgentSessionSlashCommand[] }
  /** Live background work after a membership change. REPLACE semantics — the payload is the full set. */
  | { type: 'background-tasks'; tasks: AgentSessionBackgroundTasks }
  /** Native work retaining this connection, independently from product reply completion.
   *  `awaitingReply` defaults to `active`; false keeps detached commands alive without a pending reply. */
  | { type: 'background-work-state'; active: boolean; awaitingReply?: boolean }
  /** A background command's own stream chunk, routed to its detached transcript turn. */
  /** Full set of triggering native tool calls whose background results have not drained. */
  | { type: 'background-results'; result: OperationResult<readonly string[]> }
  /** Task lifecycle that arrived with no turn stream to carry it; the host keeps the latest per task. */
  | { type: 'background-task-event'; data: AgentTaskEventPartData }
  /** Runtime-generated content started without a host-admitted user turn. `started` atomically
   *  transfers generation ownership and asks the host to open a receive-only transcript turn,
   *  carrying why the runtime opened it so the transcript can say so; `finished` releases
   *  ownership after the SDK result, independently from turn completion. */
  | {
      type: 'autonomous-turn-state'
      state: 'started'
      origin: AutonomousTurnOrigin
      sourceToolCallIds?: readonly string[]
      /** A placed product input that native recovery resumed; its existing reply continues. */
      recoveredInputId?: string
    }
  | { type: 'autonomous-turn-state'; state: 'finished' }
  /** A `retainOnStop` connection finished the requested stop; later input may start. */
  | { type: 'stop-confirmed' }
  | { type: 'error'; error: unknown }

/**
 * Verdict of {@link AgentRuntimeConnection.reconcile}.
 * - `current`: connection matches the desired config.
 * - `patched`: live-appliable facts were hot-patched; the connection is now current.
 * - `rebuild`: spawn-frozen config is stale — the host reconnects at a safe boundary (any live
 *   patches were still applied first).
 * - `invalid`: the desired config can no longer be derived (agent/session/model deleted) — close.
 * - `failed`: a live patch failed — fail closed; the connection may be enforcing the OLD policy.
 */
export type AgentRuntimeReconcileResult = 'current' | 'patched' | 'rebuild' | 'invalid' | 'failed'

export interface AgentRuntimeConnection {
  /** Bound product context for controls that precede the first native message. */
  readonly contextId?: string

  /** Pin an unclaimed Local Agent connection before the first admitted input. */
  claimLocalContext?(anchorMessageId: string): boolean

  /** Reused connections can carry another Run's settings and need reconciliation before the next admission. */
  preparedFor?(request: AgentRuntimeConnectInput): boolean
  /** Install the registered owner's callbacks on a reusable connection. */
  bindInputs?(callbacks: Pick<AgentRuntimeConnectInput, 'onSteerInjected'>): void

  predictPrompt?(signal: AbortSignal): Promise<string>
  readonly events: AsyncIterable<AgentRuntimeEvent>
  /** Permission mode currently in effect on this connection, when the runtime can identify it. */
  readonly effectivePermissionMode?: AgentPermissionMode
  readonly sessionCostScope?: 'native-session'
  readonly localRuntime?: LocalAgentRuntime
  readonly localSessionInfo?: LocalAgentSessionInfo
  selectModel?(modelId: string): Promise<LocalAgentSessionInfo>
  setConfigOption?(configId: string, value: string | boolean): Promise<LocalAgentSessionInfo>
  setMode?(configId: string, value: string): Promise<LocalAgentSessionInfo>
  setThoughtLevel?(configId: string, value: string): Promise<LocalAgentSessionInfo>
  /** The configured Runtime owner remains resident until explicit retirement. */
  readonly retainWhileIdle?: boolean
  /** Refresh per-turn observability metadata without changing spawn-fixed connection configuration. */
  refreshTraceContext?(context: AgentRuntimeTraceContext): void | Promise<void>
  /** Connection-route-owned usage capture policy and non-secret credential receipt. */
  readonly usageCapture?: AgentSessionUsageCapture
  send(input: AgentRuntimeCommand): void | Promise<void>
  readonly threadInput?: AgentRuntimeInput
  readonly compact?: CompactThread
  readonly compactWithInstructions?: true
  /** Reconcile the captured context without submitting or resuming native execution. */
  lookupInput?(contextId: string, inputId: string): Promise<OperationResult<InputLookup>>
  changeFollowups?(change: AgentSessionFollowupChange): Promise<boolean>
  acknowledgeFollowupProjection?(contextId: string, inputId: string): void
  /**
   * Re-derive the session's desired config and reconcile the running connection against it.
   * Live-appliable tool-policy facts, permission mode included, are patched in place before the
   * rebuild verdict, even during an active turn: the change governs the turn's next tool call.
   * Serialized per connection, concurrent push/pull reconciles queue instead of interleaving SDK
   * and snapshot writes.
   *
   * The input is the config the connection should serve right now (a live turn's frozen model,
   * reasoning, and knowledge selection, or the agent's latest model with defaults) — the same
   * pinning the host uses for `connect`.
   */
  reconcile(input: {
    modelId: ExecutionId
    reasoningEffort?: ReasoningEffortOption
    serviceTier?: ServiceTierSelection
    knowledgeBaseIds?: readonly string[]
    fastMode?: boolean
    headless?: boolean
    permissionModeOverride?: AgentPermissionMode
  }): Promise<AgentRuntimeReconcileResult>
  /**
   * Read passive, thread-scoped context usage from the harness. Unknown and unsupported
   * results remain explicit. The host may call this after each turn.
   */
  getContextUsage?(): Promise<OperationResult<ThreadContextUsage>>
  /** Explicit inspection for connections that push live readings and need native history for an exact refresh. */
  inspectContextUsage?(): Promise<OperationResult<ThreadContextUsage>>
  /**
   * Read this session's available slash command catalog (`query.supportedCommands()`), including
   * any custom project/user commands the SDK discovered. Returns null when the runtime can't report
   * it (no query yet, or a driver that doesn't support it). Optional ⇒ the host falls back to the
   * static builtin list.
   */
  getSupportedCommands?(): Promise<AgentSessionSlashCommand[] | null>
  stopTask?(taskId: string): Promise<boolean>
  messageChild?(contextId: string, text: string): Promise<void>
  /** Wait for admitted child execution and its archive writes; does not close the owner. */
  drainChildWrites?(): Promise<void>
  /**
   * Stop foreground work for user Stop. Without `retainOnStop` the host then retires the owner;
   * shutdown alone may preserve durable work.
   */
  interrupt?(): Promise<void>
  /**
   * User Stop only interrupts: the owner and this connection stay open for later input. After each
   * `interrupt()`, emit `stop-confirmed` once the stopped turn's terminal event has been emitted.
   */
  readonly retainOnStop?: boolean
  close(): void | Promise<void>
  /** Confirm native process exit before replacing this session's history. */
  closeForEdit?(): Promise<void>
}

export interface AgentSessionRuntimeDriver {
  readonly type: string
  /** Local CLI runtimes key execution identity by agent rather than by a spawned process. */
  getExecutionId?(agent: AgentEntity): ExecutionId | undefined
  /** Native artifact ownership and checkpoint remapping before session recovery. */
  readonly workspaceRelocation?: RuntimeWorkspaceRelocation
  /** Restore persisted runtime history after generic fork, crash and delivery recovery. */
  recoverSessions?(): Promise<void>
  recoverWork?(blocked: ReadonlySet<string>, canWrite: () => boolean): Promise<void>
  fork?(input: RuntimeForkInput): Promise<RuntimeForkResult>
  /** Validate the opaque checkpoint and its claimed product binding when supplied. */
  isForkCheckpoint?(value: unknown, binding?: Pick<AgentSessionContextRow, 'backendId' | 'nativeThreadId'>): boolean
  /**
   * Per-driver session prerequisite check: throws if the session can't be
   * served (e.g. workspace path missing, credentials absent). Hosts call
   * this before `connect()` instead of hard-coding driver-specific guards.
   * Headless runs execute the agent default, so drivers must preflight that
   * model when `opts.headless` is set instead of the session override.
   */
  validateSession(session: AgentSessionEntity, opts?: { headless?: boolean }): void | Promise<void>
  connect(input: AgentRuntimeConnectInput): Promise<AgentRuntimeConnection>
  /**
   * Notified when a session goes idle and its runtime is torn down. Lets a
   * driver run runtime-specific idle work (e.g. Claude prewarming the next
   * query) without the host reaching into driver internals. Optional.
   */
  onSessionIdle?(sessionId: string): void
  /**
   * Reclaim on-disk session state that no surviving session row claims, keyed by
   * the resume tokens the driver itself hands out. The keep-set covers trashed
   * sessions too — their rows and tokens remain until purge so Restore stays
   * lossless, and only a purge drops them. Called by the trash purge's agent
   * orphan sweep after every DB transaction has committed, so it is authoritative. Must be idempotent, must no-op when its root
   * does not exist, and must leave anything younger than `freshnessGateMs`
   * alone — an in-flight session may not have persisted its token yet.
   */
  reclaimOrphanSessions?(
    keptResumeTokens: ReadonlySet<string>,
    options: OrphanSessionReclaimOptions
  ): Promise<{ removed: string[] }>
  /**
   * Reclaim artifacts for exactly these known, permanently purged resume tokens.
   * This is not a discovery sweep: the caller has drained the runtime and deleted
   * the rows, so no freshness gate applies. Never touch artifacts for tokens
   * outside the set, even when another session writes in the same tree.
   * Must be idempotent and no-op when the runtime root does not exist.
   */
  reclaimPurgedSessions?(purgedResumeTokens: ReadonlySet<string>): Promise<{ removed: string[] }>
  /**
   * Diagnostic events (API errors, retries, failing tools, hook errors) from the tail of this runtime's
   * own transcript for a resume token, unredacted. Undefined when no readable transcript exists.
   */
  readTranscriptEvidence?(resumeToken: string, maxEntries: number): Promise<Record<string, unknown>[] | undefined>
}

export interface OrphanSessionReclaimOptions {
  /** Artifacts modified within this window are presumed in-flight and skipped. */
  freshnessGateMs: number
  now: number
}
