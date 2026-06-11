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
}

export type AgentRuntimePolicyUpdate =
  | { type: 'permission-mode'; permissionMode: AgentPermissionMode | undefined }
  | { type: 'tool-policy'; agent: AgentEntity }

export type AgentRuntimeEvent =
  | { type: 'chunk'; chunk: UIMessageChunk }
  | { type: 'resume-token'; token: string }
  | { type: 'turn-complete' }
  | { type: 'error'; error: unknown }

export interface AgentRuntimeConnection {
  readonly events: AsyncIterable<AgentRuntimeEvent>
  send(input: AgentRuntimeUserInput): void | Promise<void>
  applyPolicyUpdate?(update: AgentRuntimePolicyUpdate): Promise<boolean> | boolean
  interrupt?(): Promise<void>
  /**
   * Runtime-specific predicate: is it safe to interrupt the current turn right
   * now? The host falls back to "no tool is mid-execution" when a connection
   * omits it, so existing runtimes keep their behaviour; lets a runtime that
   * tracks its own tool state self-manage interruptibility.
   */
  canInterruptNow?(): boolean
  /**
   * Runtime-specific policy: should the host tear this connection down once the
   * current turn ends? Lets a driver (e.g. Claude trace mode) own the decision
   * instead of the host reaching into driver internals. Omitted ⇒ keep open.
   */
  shouldCloseAfterTurn?(): boolean
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
