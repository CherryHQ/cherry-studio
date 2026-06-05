import {
  type Options,
  type Query,
  query as createClaudeQuery,
  type SDKResultMessage,
  type SDKSystemMessage,
  type SDKUserMessage
} from '@anthropic-ai/claude-agent-sdk'

type BetaUsage = SDKResultMessage['usage']
import { loggerService } from '@logger'
import type { ClaudeAgentToolPolicySnapshot } from '@main/ai/tools/adapters/claudeCode/agentTools'
import {
  buildClaudeToolPolicy,
  descriptorToTool,
  listClaudeAgentToolDescriptors
} from '@main/ai/tools/adapters/claudeCode/agentTools'
import { application } from '@main/core/application'
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
import { AgentSessionWorkspaceError, assertClaudeCodeWorkspaceDirectory } from './settingsBuilder'
import { ClaudeCodeStreamAdapter, convertClaudeCodeUsage } from './streamAdapter'
import type { McpToolDisplayMetadata, ToolApprovalEmitterHolder } from './types'

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
    this.mcpToolMetadata = request.settings.mcpToolMetadata
    this.toolPolicySnapshot = request.settings.toolPolicySnapshot
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

    this.sdkInputQueue.push(toSdkUserMessage(input.message, this.resumeToken))
  }

  async interrupt(): Promise<void> {
    this.adapter?.finalizeOpenParts()
    await this.query?.interrupt()
  }

  shouldCloseAfterTurn(): boolean {
    return Boolean(this.input.trace) && application.get('ClaudeCodeTraceBridgeService').isTraceModeEnabled()
  }

  async applyPolicyUpdate(update: AgentRuntimePolicyUpdate): Promise<boolean> {
    if (!this.query) return false
    if (update.type === 'tool-policy') {
      await this.toolPolicySnapshot?.update(update.agent)
      return true
    }
    this.toolPolicySnapshot?.setPermissionMode(update.permissionMode)
    await this.query.setPermissionMode(update.permissionMode ?? 'default')
    return true
  }

  close(): void {
    this.sdkInputQueue.close()
    this.abortController.abort('agent-runtime-closed')
    this.disposeApprovalEmitter()
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

        if (!this.adapter) {
          if (message.type === 'result') {
            this.updateResumeToken(message.session_id)
            logger.warn('Received a result message with no active turn; dropping turn-complete', {
              sessionId: this.input.sessionId
            })
          }
          continue
        }

        const result = this.adapter.handleMessage(message)
        if (result.type === 'result') {
          this.updateResumeToken(result.sessionId)
          // `readUIMessageStream` only reads token counts from `message-metadata`
          // chunks. The streamAdapter's V3-shaped `finish.usage` is ignored, so
          // we project the SDK BetaUsage onto a UIMessageChunk here — keeping
          // the chunk shape identical to `attachUsageObserver` (AI SDK runtime).
          this.emitUsageMetadata(result.message.usage)
          this.adapter = undefined
          this.disposeApprovalEmitter()
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
      this.disposeApprovalEmitter()
      this.eventQueue.push(salvaged ? { type: 'turn-complete' } : { type: 'error', error })
    } finally {
      this.query = undefined
      this.eventQueue.close()
    }
  }

  private createAdapter(modelId: string): ClaudeCodeStreamAdapter {
    this.bindApprovalEmitter()
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

  private disposeApprovalEmitter(): void {
    this.approvalEmitter?.dispose?.()
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
}

function toSdkUserMessage(message: AgentSessionMessageEntity, resumeToken?: string): SDKUserMessage {
  return {
    type: 'user',
    message: { role: 'user', content: extractMessageText(message) },
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

  validateSession(session: AgentSessionEntity): void {
    const cwd = session.workspace?.path
    if (!cwd) {
      throw new AgentSessionWorkspaceError(`Agent session ${session.id} has no workspace configured`)
    }
    assertClaudeCodeWorkspaceDirectory(session.id, cwd)
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
