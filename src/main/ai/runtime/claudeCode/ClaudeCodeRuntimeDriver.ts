import {
  type Options,
  type Query,
  query as createClaudeQuery,
  type SDKCompactBoundaryMessage,
  type SDKMessage,
  type SDKResultMessage,
  type SDKStatusMessage,
  type SDKSystemMessage,
  type SDKUserMessage
} from '@anthropic-ai/claude-agent-sdk'

type BetaUsage = SDKResultMessage['usage']
type SDKRuntimeSystemMessage = Extract<SDKMessage, { type: 'system' }>
type SDKCompactionSystemMessage = SDKCompactBoundaryMessage | SDKStatusMessage
import { loggerService } from '@logger'
import { wrapSteerReminder } from '@main/ai/steerReminder'
import type { ClaudeAgentToolPolicySnapshot } from '@main/ai/tools/adapters/claudeCode/agentTools'
import {
  buildClaudeToolPolicy,
  descriptorToTool,
  listClaudeAgentToolDescriptors
} from '@main/ai/tools/adapters/claudeCode/agentTools'
import { application } from '@main/core/application'
import type { AgentSessionCompactionAnchorData } from '@shared/ai/agentSessionCompaction'
import type { AgentSessionContextUsage } from '@shared/ai/agentSessionContextUsage'
import type { Tool } from '@shared/ai/tool'
import type { AgentSessionEntity, AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessions'

import type {
  AgentRuntimeConnectInput,
  AgentRuntimeConnection,
  AgentRuntimeEvent,
  AgentRuntimePolicyUpdate,
  AgentRuntimeUserInput,
  AgentSessionRuntimeDriver
} from '../types'
import { buildClaudeCodeQueryRequestForAgentSession } from './agentSessionWarmup'
import {
  AgentSessionWorkspaceError,
  disposeToolPolicySnapshot,
  prepareClaudeCodeWorkspaceDirectory
} from './settingsBuilder'
import { ClaudeCodeStreamAdapter, convertClaudeCodeUsage } from './streamAdapter'
import type { McpToolDisplayMetadata, SteerHolder, ToolApprovalEmitterHolder } from './types'

const logger = loggerService.withContext('ClaudeCodeRuntimeDriver')

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly items: T[] = []
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = []
  private closed = false

  push(item: T): void {
    if (this.closed) return
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter({ value: item, done: false })
      return
    }
    this.items.push(item)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    while (this.waiters.length > 0) {
      this.waiters.shift()?.({ value: undefined as T, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const item = this.items.shift()
        if (item) return Promise.resolve({ value: item, done: false })
        if (this.closed) return Promise.resolve({ value: undefined as T, done: true })
        return new Promise<IteratorResult<T>>((resolve) => {
          this.waiters.push(resolve)
        })
      }
    }
  }
}

class SdkInputQueue implements AsyncIterable<SDKUserMessage> {
  private readonly messages: SDKUserMessage[] = []
  private waitResolve?: (value: IteratorResult<SDKUserMessage>) => void
  private closed = false

  push(message: SDKUserMessage): void {
    if (this.closed) return
    if (this.waitResolve) {
      const resolve = this.waitResolve
      this.waitResolve = undefined
      resolve({ value: message, done: false })
      return
    }
    this.messages.push(message)
  }

  close(): void {
    this.closed = true
    if (this.waitResolve) {
      const resolve = this.waitResolve
      this.waitResolve = undefined
      resolve({ value: undefined as unknown as SDKUserMessage, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const next = this.messages.shift()
        if (next) return Promise.resolve({ value: next, done: false })
        if (this.closed) return Promise.resolve({ value: undefined as unknown as SDKUserMessage, done: true })
        return new Promise<IteratorResult<SDKUserMessage>>((resolve) => {
          this.waitResolve = resolve
        })
      }
    }
  }
}

class ClaudeCodeRuntimeConnection implements AgentRuntimeConnection {
  private readonly eventQueue = new AsyncEventQueue<AgentRuntimeEvent>()
  private readonly sdkInputQueue = new SdkInputQueue()
  private readonly abortController = new AbortController()
  private query?: Query
  private adapter?: ClaudeCodeStreamAdapter
  private adapterModelId?: string
  private approvalEmitter?: ToolApprovalEmitterHolder
  private mcpToolMetadata?: Record<string, McpToolDisplayMetadata>
  private pendingInitMessage?: SDKSystemMessage
  private resumeToken?: string
  private toolPolicySnapshot?: ClaudeAgentToolPolicySnapshot
  private steerHolder?: SteerHolder
  /** Set when the PreToolUse hook injects a steer; the next top-level assistant `message_start`
   *  emits a `steer-boundary` (rolls A1a + A2) and clears this. */
  private steerBoundaryPending?: AgentRuntimeUserInput[]

  readonly events = this.eventQueue

  constructor(private readonly input: AgentRuntimeConnectInput) {
    this.resumeToken = input.resumeToken
  }

  async start(): Promise<this> {
    const request = await buildClaudeCodeQueryRequestForAgentSession(this.input.sessionId, this.resumeToken)
    if (!request) {
      throw new Error(`Unable to build Claude Code query options for agent session ${this.input.sessionId}`)
    }

    const traceEnv = await this.prepareTraceEnv()
    const options: Options = {
      ...request.options,
      ...(traceEnv
        ? {
            env: {
              ...request.options.env,
              ...traceEnv
            }
          }
        : {}),
      abortController: this.abortController
    }
    const warmQuery = traceEnv
      ? undefined
      : await application.get('ClaudeCodeWarmQueryManager').consume({
          key: request.key,
          options,
          initializeTimeoutMs: request.initializeTimeoutMs
        })

    this.query = warmQuery
      ? warmQuery.query(this.sdkInputQueue)
      : createClaudeQuery({ prompt: this.sdkInputQueue, options })
    this.adapterModelId = request.sdkModelId
    this.approvalEmitter = request.settings.approvalEmitter
    // Bind the approval emit once for the connection's lifetime — it only pushes into the connection
    // event queue, so it never varies per turn. (The prior per-turn rebind was the mirror of the
    // now-removed per-turn dispose; both gone, the emitter is plainly session-scoped.)
    this.bindApprovalEmitter()
    this.mcpToolMetadata = request.settings.mcpToolMetadata
    this.toolPolicySnapshot = request.settings.toolPolicySnapshot
    this.steerHolder = request.settings.steerHolder
    // Arm a `steer-boundary` when the PreToolUse hook injects a steer this turn. Bound on the live
    // connection (not the warm prewarm) so the boundary is observed by this connection's query loop.
    if (this.steerHolder) {
      this.steerHolder.onInjected = (inputs) => {
        this.steerBoundaryPending = inputs
      }
    }
    void this.runQueryLoop()
    return this
  }

  private async prepareTraceEnv(): Promise<Record<string, string> | undefined> {
    if (!this.input.trace) return undefined
    return application.get('ClaudeCodeTraceBridgeService').prepareTrace(this.input.trace)
  }

  send(input: AgentRuntimeUserInput): void {
    this.adapter = this.createAdapter(this.adapterModelId ?? this.input.modelId)

    if (this.pendingInitMessage) {
      this.adapter.handleMessage(this.pendingInitMessage)
      this.pendingInitMessage = undefined
    }

    this.sdkInputQueue.push(toSdkUserMessage(input.message, this.resumeToken, input.systemReminder))
  }

  redirect(input: AgentRuntimeUserInput): boolean {
    // No active turn (no live adapter) → can't steer; the host queues this as the next turn.
    if (!this.adapter || !this.steerHolder) return false
    // Stash for the PreToolUse steer hook to inject as `additionalContext` before the next tool runs.
    // If the turn ends with no tool call, runQueryLoop emits `steer-undelivered` and the host queues it.
    this.steerHolder.pending.push(input)
    return true
  }

  async applyPolicyUpdate(update: AgentRuntimePolicyUpdate): Promise<boolean> {
    if (!this.query) return false
    if (update.type === 'tool-policy') {
      await this.toolPolicySnapshot?.update(update.agent)
      return true
    }
    if (this.toolPolicySnapshot?.getPermissionMode() === update.permissionMode) return true
    await this.query.setPermissionMode(update.permissionMode ?? 'default')
    this.toolPolicySnapshot?.setPermissionMode(update.permissionMode)
    return true
  }

  async getContextUsage(): Promise<AgentSessionContextUsage | null> {
    if (!this.query) return null
    try {
      return await this.query.getContextUsage()
    } catch (error) {
      logger.warn('getContextUsage failed', { sessionId: this.input.sessionId, error })
      return null
    }
  }

  close(): void {
    this.sdkInputQueue.close()
    this.abortController.abort('agent-runtime-closed')
    this.steerBoundaryPending = undefined
    this.teardownSession()
    this.query?.close()
    this.eventQueue.close()
  }

  private async runQueryLoop(): Promise<void> {
    try {
      for await (const message of this.query!) {
        if (message.type === 'system' && message.subtype === 'init') {
          this.updateResumeToken(message.session_id)
          if (!this.adapter) {
            this.pendingInitMessage = message
            continue
          }
        }

        if (
          message.type === 'system' &&
          isCompactionSystemMessage(message) &&
          this.handleSystemControlMessage(message)
        ) {
          continue
        }

        if (!this.adapter) {
          if (message.type === 'result') {
            this.updateResumeToken(message.session_id)
            logger.warn('Received a result message with no active turn; dropping turn-complete', {
              sessionId: this.input.sessionId
            })
          }
          continue
        }

        // A steer was injected this turn → the first TOP-LEVEL assistant message after it (the model's
        // post-steer response; subagent/nested messages carry a parent_tool_use_id and are skipped) is
        // where the host rolls A1a + A2. Emit the boundary BEFORE the adapter handles this message so it
        // lands ahead of A2's content chunks in the event stream. (message_start is a no-op in the adapter.)
        if (
          this.steerBoundaryPending &&
          message.type === 'stream_event' &&
          message.event.type === 'message_start' &&
          message.parent_tool_use_id == null
        ) {
          this.eventQueue.push({ type: 'steer-boundary', inputs: this.steerBoundaryPending })
          this.steerBoundaryPending = undefined
        }

        const result = this.adapter.handleMessage(message)
        if (result.type === 'result') {
          this.updateResumeToken(result.sessionId)
          // The steer was injected but no post-steer top-level assistant message followed (rare; the
          // turn ended right after the gated tool). Drop the arm — no boundary, no empty A2.
          this.steerBoundaryPending = undefined
          // `readUIMessageStream` only reads token counts from `message-metadata`
          // chunks. The streamAdapter's V3-shaped `finish.usage` is ignored, so
          // we project the SDK BetaUsage onto a UIMessageChunk here — keeping
          // the chunk shape identical to `attachUsageObserver` (AI SDK runtime).
          this.emitUsageMetadata(result.message.usage)
          await this.emitContextUsage()
          this.adapter = undefined
          // NOTE: do NOT dispose the approval emitter here. It is session-scoped — it lives across
          // turns on the warm connection and is torn down only on close/error (below). Disposing it
          // per turn evicted the session emitter, so the next turn's `canUseTool` resolved no emitter
          // and denied with "Approval emitter not ready" (the approval never reached the renderer).
          // Steers not injected by the hook this turn (the turn called no tool after they arrived) →
          // hand them back so the host queues them as the next turn (the steer_undelivered fallback).
          const undelivered = this.steerHolder?.pending.splice(0) ?? []
          if (undelivered.length > 0) this.eventQueue.push({ type: 'steer-undelivered', inputs: undelivered })
          this.eventQueue.push({ type: 'turn-complete' })
        }
      }
    } catch (error) {
      // The Claude Code SDK sometimes ends the stream abruptly mid-output. When
      // enough text was already buffered, salvage it as a truncated turn (the
      // adapter emits the buffered text + a `truncated` finish through the sink)
      // instead of dropping the partial response and surfacing an error.
      const salvaged = this.adapter?.handleTruncationError(error) ?? false
      this.adapter = undefined
      // The query stream ended (errored) → the connection is dead; tear the whole session down here
      // rather than relying on a later close() to dispose the steer holder / snapshot.
      this.teardownSession()
      this.eventQueue.push(salvaged ? { type: 'turn-complete' } : { type: 'error', error })
    } finally {
      this.query = undefined
      this.eventQueue.close()
    }
  }

  private createAdapter(modelId: string): ClaudeCodeStreamAdapter {
    return new ClaudeCodeStreamAdapter({
      modelId,
      streamOptions: {} as never,
      sink: {
        enqueue: (chunk) => this.eventQueue.push({ type: 'chunk', chunk })
      },
      onSessionId: (resumeToken) => this.updateResumeToken(resumeToken),
      mcpToolMetadata: this.mcpToolMetadata
    })
  }

  private bindApprovalEmitter(): void {
    if (!this.approvalEmitter) return
    this.approvalEmitter.emit = (chunk) => this.eventQueue.push({ type: 'chunk', chunk })
  }

  /**
   * Tear down all session-scoped resources. This is the ONLY place they are disposed — wired only to
   * close()/the query-loop error path, never to a turn boundary. Centralising disposal here is what
   * keeps the lifetime correct: there is no per-resource dispose for a turn handler to misplace.
   * Idempotent (each holder's dispose is), so the close-after-error double call is safe.
   */
  private teardownSession(): void {
    this.approvalEmitter?.dispose?.()
    this.steerHolder?.dispose()
    disposeToolPolicySnapshot(this.input.sessionId)
  }

  private updateResumeToken(resumeToken: string): void {
    if (resumeToken === this.resumeToken) return
    this.resumeToken = resumeToken
    this.eventQueue.push({ type: 'resume-token', token: resumeToken })
  }

  private emitUsageMetadata(usage: BetaUsage | undefined): void {
    if (!usage) return
    const v3Usage = convertClaudeCodeUsage(usage)
    const promptTokens = v3Usage.inputTokens.total ?? 0
    const completionTokens = v3Usage.outputTokens.total ?? 0
    const reasoningTokens = v3Usage.outputTokens.reasoning
    this.eventQueue.push({
      type: 'chunk',
      chunk: {
        type: 'message-metadata',
        messageMetadata: {
          totalTokens: promptTokens + completionTokens,
          promptTokens,
          completionTokens,
          ...(reasoningTokens !== undefined ? { thoughtsTokens: reasoningTokens } : {})
        }
      }
    })
  }

  private async emitContextUsage(): Promise<void> {
    if (!this.query) return
    try {
      const usage = await this.query.getContextUsage()
      this.eventQueue.push({ type: 'context-usage', usage })
    } catch (error) {
      logger.warn('getContextUsage failed after result', { sessionId: this.input.sessionId, error })
    }
  }

  private handleSystemControlMessage(message: SDKCompactionSystemMessage): boolean {
    if (message.subtype === 'status') {
      if (message.status === 'compacting') {
        this.eventQueue.push({ type: 'compaction-start' })
        return true
      }
      if (message.compact_result === 'failed' || message.compact_error) {
        this.eventQueue.push({ type: 'compaction-error', error: message.compact_error ?? 'Compaction failed' })
        return true
      }
      if (message.compact_result === 'success') {
        this.eventQueue.push({ type: 'compaction-complete' })
        return true
      }
      return true
    }

    if (message.subtype === 'compact_boundary') {
      const metadata = message.compact_metadata
      const anchor: AgentSessionCompactionAnchorData = {
        trigger: metadata.trigger,
        completedAt: new Date().toISOString()
      }
      anchor.preTokens = metadata.pre_tokens
      if (metadata.post_tokens !== undefined) anchor.postTokens = metadata.post_tokens
      if (metadata.duration_ms !== undefined) anchor.durationMs = metadata.duration_ms

      this.eventQueue.push({ type: 'compaction-complete', anchor })
      return true
    }

    return false
  }
}

function isCompactionSystemMessage(message: SDKRuntimeSystemMessage): message is SDKCompactionSystemMessage {
  return message.subtype === 'status' || message.subtype === 'compact_boundary'
}

function toSdkUserMessage(
  message: AgentSessionMessageEntity,
  resumeToken?: string,
  systemReminder = false
): SDKUserMessage {
  const text = extractMessageText(message)
  return {
    type: 'user',
    message: { role: 'user', content: systemReminder && text.trim() ? wrapSteerReminder(text) : text },
    parent_tool_use_id: null,
    session_id: resumeToken ?? ''
  }
}

function extractMessageText(message: AgentSessionMessageEntity): string {
  return (
    message.data?.parts
      ?.filter((part): part is { type: 'text'; text: string } => part.type === 'text' && 'text' in part)
      .map((part) => part.text)
      .join('\n') ?? ''
  )
}

export class ClaudeCodeRuntimeDriver implements AgentSessionRuntimeDriver {
  readonly type = 'claude-code'
  readonly capabilities = ['agent-session'] as const

  async validateSession(session: AgentSessionEntity): Promise<void> {
    const cwd = session.workspace?.path
    if (!cwd) {
      throw new AgentSessionWorkspaceError(`Agent session ${session.id} has no workspace configured`)
    }
    await prepareClaudeCodeWorkspaceDirectory(session)
  }

  async listAvailableTools(mcpIds: string[]): Promise<Tool[]> {
    const catalog = await listClaudeAgentToolDescriptors({ mcps: mcpIds })
    const policy = buildClaudeToolPolicy({})
    return catalog.descriptors.map((descriptor) => descriptorToTool(descriptor, policy))
  }

  async connect(input: AgentRuntimeConnectInput): Promise<AgentRuntimeConnection> {
    return new ClaudeCodeRuntimeConnection(input).start()
  }

  onSessionIdle(sessionId: string): void {
    // `prewarmAgentSession` already no-ops in trace mode (it closes any warm
    // queries and returns), so no driver-side trace guard is needed here.
    void application.get('ClaudeCodeWarmQueryManager').prewarmAgentSession(sessionId)
  }
}
