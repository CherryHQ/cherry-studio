import type { AgentSessionCompactionAnchorData, AgentSessionCompactionTrigger } from '@shared/ai/agentSessionCompaction'
import type { AgentSessionContextUsage } from '@shared/ai/agentSessionContextUsage'
import type { Tool } from '@shared/ai/tool'
import type { AgentEntity, AgentPermissionMode } from '@shared/data/api/schemas/agents'
import type { AgentSessionEntity, AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessions'
import type { UniqueModelId } from '@shared/data/types/model'
import type { UIMessageChunk } from 'ai'

export type AiRuntimeCapability = 'agent-session' | 'chat-turn' | 'generate-text' | 'embed' | 'image'

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
  resumeToken?: string
  trace?: AgentRuntimeTraceContext
}

export interface AgentRuntimeUserInput {
  message: AgentSessionMessageEntity
  /** True when this message arrived mid-turn (a steer) — the driver wraps it in a system-reminder
   *  so the model treats it as a redirect rather than a fresh prompt (invariant 7). */
  systemReminder?: boolean
}

export type AgentRuntimePolicyUpdate =
  | { type: 'permission-mode'; permissionMode: AgentPermissionMode | undefined }
  | { type: 'tool-policy'; agent: Pick<AgentEntity, 'mcps' | 'disabledTools' | 'configuration'> }

export type AgentRuntimeEvent =
  | { type: 'chunk'; chunk: UIMessageChunk }
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
  | { type: 'context-usage'; usage: AgentSessionContextUsage }
  | { type: 'error'; error: unknown }

export interface AgentRuntimeConnection {
  readonly events: AsyncIterable<AgentRuntimeEvent>
  send(input: AgentRuntimeUserInput): void | Promise<void>
  /**
   * Inject a mid-turn user message (steer) into the running turn without aborting it. Returns true
   * when the message was stashed for injection (a turn is live) — the host then folds it into the
   * current turn instead of opening a new one; if the turn ends before it is injected the connection
   * emits `steer-undelivered`. Returns false when there is no live turn to steer, so the host queues
   * the message as the next turn. Omitted ⇒ no native steer ⇒ host always queues.
   */
  redirect?(input: AgentRuntimeUserInput): boolean
  applyPolicyUpdate?(update: AgentRuntimePolicyUpdate): Promise<boolean> | boolean
  /**
   * Read the live context-window usage for this connection's session. Returns null when the
   * underlying runtime can't report it (no query yet, or a driver that doesn't support it).
   * Optional ⇒ the host treats the runtime as unable to report usage.
   */
  getContextUsage?(): Promise<AgentSessionContextUsage | null>
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
