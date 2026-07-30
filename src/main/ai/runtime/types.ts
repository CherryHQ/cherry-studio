import type { AiUsageCredentialReceipt, SourceSnapshot } from '@data/services/AiUsageRecordService'
import type { AgentSessionApiRetryInfo } from '@shared/ai/agentSessionApiRetry'
import type { AgentSessionCompactionAnchorData, AgentSessionCompactionTrigger } from '@shared/ai/agentSessionCompaction'
import type { AgentSessionContextUsage } from '@shared/ai/agentSessionContextUsage'
import type { AgentSessionSlashCommand } from '@shared/ai/agentSessionSlashCommands'
import type { Tool } from '@shared/ai/tool'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { AiUsagePricingSnapshot } from '@shared/data/types/aiUsageRecord'
import type { UniqueModelId } from '@shared/data/types/model'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'
import type { UIMessageChunk } from 'ai'

export type AiRuntimeCapability = 'agent-session' | 'chat-turn' | 'generate-text' | 'embed' | 'image'

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
        modelName: string | null
        aliases: readonly string[]
        pricingSnapshot: AiUsagePricingSnapshot | null
      }>
    }
  | { owner: 'provider-calls' }

export interface AiRuntimeDriver {
  readonly type: string
  readonly capabilities: readonly AiRuntimeCapability[]
}

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
  modelId: UniqueModelId
  /** Canonical reasoning selection frozen for this connection's turn. */
  reasoningEffort?: ReasoningEffortOption
  /** Per-turn composer knowledge selection; static Agent bindings still take precedence. */
  knowledgeBaseIds?: readonly string[]
  resumeToken?: string
  trace?: AgentRuntimeTraceContext
  /**
   * Synchronous host hook fired when a pending steer is actually injected. The host uses this
   * before the SDK can issue its next provider request to reserve the continuation correlation;
   * the later `steer-boundary` event still owns the visible A1 -> A2 message roll.
   */
  onSteerInjected?: (inputs: AgentRuntimeUserInput[]) => void
}

export interface AgentRuntimeUserInput {
  message: AgentSessionMessageEntity
  /** True when this message arrived mid-turn (a steer) — the driver wraps it in a system-reminder
   *  so the model treats it as a redirect rather than a fresh prompt (invariant 7). */
  systemReminder?: boolean
}

export type AgentRuntimeEvent =
  | { type: 'chunk'; chunk: UIMessageChunk }
  | {
      type: 'usage'
      invocation: {
        requestId: string
        model: string
        /** Frozen when the provider invocation is first observed; never inferred later from host turn state. */
        messageAssociation: 'current-turn' | 'stateless'
        usage?: {
          inputTokens: number
          outputTokens: number
          totalTokens: number
          noCacheTokens: number
          cacheReadTokens: number
          cacheWriteTokens: number
        }
        metrics?: {
          timeFirstTokenMs?: number
          timeCompletionMs?: number
          timeThinkingMs?: number
        }
      }
    }
  | { type: 'resume-token'; token: string }
  | { type: 'turn-complete' }
  /** Steers stashed via `redirect()` that the turn ended before injecting — the host queues them
   *  as the next turn (the `steer_undelivered` fallback). */
  | { type: 'steer-undelivered'; inputs: AgentRuntimeUserInput[] }
  /** A steer was injected mid-turn (PreToolUse hook) and the model is about to emit its post-steer
   *  assistant message. Marks where the host should roll the assistant message: finalise the
   *  pre-steer parts as one row (A1a) and stream the continuation into a fresh row (A2), so the
   *  steer user message sorts between them instead of dangling after the whole turn. */
  | { type: 'steer-boundary'; inputs: AgentRuntimeUserInput[] }
  | { type: 'compaction-start'; trigger?: AgentSessionCompactionTrigger }
  | { type: 'compaction-complete'; anchor?: AgentSessionCompactionAnchorData }
  | { type: 'compaction-error'; error: string }
  /** The SDK is backing off before retrying a failed API request (`system/api_retry`). Ephemeral
   *  session status — the host surfaces it in the message stream and clears it when content resumes,
   *  the turn ends/errors/cancels, or the connection closes. Never persisted as conversation content. */
  | { type: 'api-retry'; retry: AgentSessionApiRetryInfo }
  | { type: 'context-usage'; usage: AgentSessionContextUsage }
  /** The SDK pushed a fresh slash-command catalog mid-session (`system / commands_changed`) — e.g.
   *  skills discovered as the agent works in a subdirectory. `supportedCommands()` is captured at
   *  init and never reflects this, so the host REPLACES its cached list from `commands`. */
  | { type: 'supported-commands'; commands: AgentSessionSlashCommand[] }
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
  readonly events: AsyncIterable<AgentRuntimeEvent>
  /** Connection-route-owned usage capture policy and non-secret credential receipt. */
  readonly usageCapture?: AgentSessionUsageCapture
  send(input: AgentRuntimeUserInput): void | Promise<void>
  /**
   * Inject a mid-turn user message (steer) into the running turn without aborting it. Returns true
   * when the message was stashed for injection (a turn is live) — the host then folds it into the
   * current turn instead of opening a new one; if the turn ends before it is injected the connection
   * emits `steer-undelivered`. Returns false when there is no live turn or the message cannot be
   * injected by this driver, so the host queues it as the next turn. Omitted ⇒ no native steer ⇒
   * host always queues.
   */
  redirect?(input: AgentRuntimeUserInput): boolean
  /**
   * Re-derive the session's desired config and reconcile the running connection against it.
   * Live-appliable facts (tool policy) are patched in place FIRST — even mid-turn, so a security
   * tighten is never deferred behind a rebuild a live turn postpones — then the rebuild signature
   * decides the verdict (see {@link AgentRuntimeReconcileResult}). Serialized per connection:
   * concurrent push/pull reconciles queue instead of interleaving SDK and snapshot writes.
   *
   * The input is the config the connection should serve right now (a live turn's frozen model,
   * reasoning, and knowledge selection, or the agent's latest model with defaults) — the same
   * pinning the host uses for `connect`.
   */
  // ponytail: single driver — make optional with a capability fallback when a 2nd connection type ships
  reconcile(input: {
    /** Agent identity the connection must serve; omitted only by legacy tests/callers. */
    agentId?: string
    modelId: UniqueModelId
    reasoningEffort?: ReasoningEffortOption
    knowledgeBaseIds?: readonly string[]
  }): Promise<AgentRuntimeReconcileResult>
  /**
   * Read the live context-window usage for this connection's session. Returns null when the
   * underlying runtime can't report it (no query yet, or a driver that doesn't support it).
   * Optional ⇒ the host treats the runtime as unable to report usage.
   */
  getContextUsage?(): Promise<AgentSessionContextUsage | null>
  /**
   * Read this session's available slash command catalog (`query.supportedCommands()`), including
   * any custom project/user commands the SDK discovered. Returns null when the runtime can't report
   * it (no query yet, or a driver that doesn't support it). Optional ⇒ the host falls back to the
   * static builtin list.
   */
  getSupportedCommands?(): Promise<AgentSessionSlashCommand[] | null>
  close(): void | Promise<void>
}

export interface AgentSessionRuntimeDriver extends AiRuntimeDriver {
  /**
   * Per-driver session prerequisite check: throws if the session can't be
   * served (e.g. workspace path missing, credentials absent). Hosts call
   * this before `connect()` instead of hard-coding driver-specific guards.
   */
  validateSession(session: AgentSessionEntity): void | Promise<void>
  /** Enumerate the tools this driver exposes for the given MCP server set. */
  listAvailableTools(mcpIds: string[]): Promise<Tool[]>
  connect(input: AgentRuntimeConnectInput): Promise<AgentRuntimeConnection>
  /**
   * Notified when a session goes idle and its runtime is torn down. Lets a
   * driver run runtime-specific idle work (e.g. Claude prewarming the next
   * query) without the host reaching into driver internals. Optional.
   */
  onSessionIdle?(sessionId: string): void
}
