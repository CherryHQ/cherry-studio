import { fileURLToPath } from 'node:url'

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
import type { ImageBlockParam } from '@anthropic-ai/sdk/resources/messages'

type BetaUsage = SDKResultMessage['usage']
type SDKRuntimeSystemMessage = Extract<SDKMessage, { type: 'system' }>
type SDKCompactionSystemMessage = SDKCompactBoundaryMessage | SDKStatusMessage
import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { loggerService } from '@logger'
import { collectFileAttachments, prepareChatMessages } from '@main/ai/messages/attachmentRouting'
import { materializeNativeFilePart } from '@main/ai/messages/fileProcessor'
import { wrapSteerReminder } from '@main/ai/steerReminder'
import type { ClaudeAgentToolPolicySnapshot } from '@main/ai/tools/adapters/claudeCode/agentTools'
import {
  buildClaudeToolPolicy,
  descriptorToTool,
  listClaudeAgentToolDescriptors
} from '@main/ai/tools/adapters/claudeCode/agentTools'
import type { AgentSessionCompactionAnchorData } from '@shared/ai/agentSessionCompaction'
import type { AgentSessionContextUsage } from '@shared/ai/agentSessionContextUsage'
import type { AgentSessionSlashCommand } from '@shared/ai/agentSessionSlashCommands'
import type { Tool } from '@shared/ai/tool'
import type { AgentPermissionMode } from '@shared/data/api/schemas/agents'
import type { AgentSessionEntity, AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessions'
import type { CherryUIMessage, FileUIPart } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import { readCherryMeta } from '@shared/data/types/uiParts'
import { parseDataUrl } from '@shared/utils/dataUrl'

import type {
  AgentRuntimeConnectInput,
  AgentRuntimeConnection,
  AgentRuntimeEvent,
  AgentRuntimeReconcileResult,
  AgentRuntimeUserInput,
  AgentSessionRuntimeDriver
} from '../types'
import {
  buildClaudeCodeQueryRequestForAgentSession,
  type ConnectionConfig,
  deriveConnectionConfig,
  toolPolicyFactsEqual
} from './agentSessionWarmup'
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
  private sessionTornDown = false
  /** Staleness identity captured by the materialized request; live facts advance during reconcile. */
  private connectionConfig?: ConnectionConfig
  /** Serializes reconciles per connection so push/pull can't interleave SDK and snapshot writes. */
  private reconcileChain: Promise<unknown> = Promise.resolve()
  /** Set when the PreToolUse hook injects a steer; the next top-level assistant `message_start`
   *  emits a `steer-boundary` (rolls A1a + A2) and clears this. */
  private steerBoundaryPending?: AgentRuntimeUserInput[]

  readonly events = this.eventQueue

  constructor(private readonly input: AgentRuntimeConnectInput) {
    this.resumeToken = input.resumeToken
  }

  async start(): Promise<this> {
    // Route with the host-chosen model, not a fresh DB read: a live turn's connection must serve
    // the model captured when that turn was created, even if the agent was edited since.
    const request = await buildClaudeCodeQueryRequestForAgentSession(
      this.input.sessionId,
      this.resumeToken,
      this.input.modelId
    )
    if (!request) {
      throw new Error(`Unable to build Claude Code query options for agent session ${this.input.sessionId}`)
    }
    this.connectionConfig = request.connectionConfig

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
          initializeTimeoutMs: request.initializeTimeoutMs,
          credentialsFingerprint: request.credentialsFingerprint
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

  async send(input: AgentRuntimeUserInput): Promise<void> {
    this.adapter = this.createAdapter(this.adapterModelId ?? this.input.modelId)

    if (this.pendingInitMessage) {
      this.adapter.handleMessage(this.pendingInitMessage)
      this.pendingInitMessage = undefined
    }

    this.sdkInputQueue.push(await toSdkUserMessage(input.message, this.resumeToken, input.systemReminder))
  }

  redirect(input: AgentRuntimeUserInput): boolean {
    // The hook can only inject text. Decline attachments so the host owns them immediately and queues
    // them as the next SDK turn instead of leaving them in session-scoped state until this turn ends.
    const hasAttachments = input.message.data?.parts?.some((part) => part.type !== 'text') ?? false
    if (!this.adapter || !this.steerHolder || hasAttachments) return false
    // Stash for the PreToolUse steer hook to inject as `additionalContext` before the next tool runs.
    // If the turn ends with no tool call, runQueryLoop emits `steer-undelivered` and the host queues it.
    this.steerHolder.pending.push(input)
    return true
  }

  async reconcile(input: { modelId: UniqueModelId }): Promise<AgentRuntimeReconcileResult> {
    // Serialize per connection: a push (agent-updated) and a pull (fresh-turn check) reconciling
    // concurrently could interleave the SDK setPermissionMode and snapshot writes, leaving the local
    // gate and the subprocess on different policies.
    const run = this.reconcileChain.then(
      () => this.reconcileOnce(input),
      () => this.reconcileOnce(input)
    )
    this.reconcileChain = run.catch(() => undefined)
    return run
  }

  private async reconcileOnce(input: { modelId: UniqueModelId }): Promise<AgentRuntimeReconcileResult> {
    if (!this.query) return 'rebuild'
    const derived = await deriveConnectionConfig(this.input.sessionId, input.modelId)
    if (!derived.ok) return 'invalid'
    const baseline = this.connectionConfig
    // A connection without its materialized baseline cannot prove what the subprocess serves.
    if (!baseline) return 'rebuild'

    const fresh = derived.config
    let patched = false
    // Live-first: apply the tool-policy facts BEFORE the rebuild verdict, so a combined update
    // (e.g. a wholesale configuration edit touching max_turns AND tightening the permission mode)
    // can't defer the tighten behind a rebuild that a live turn postpones.
    if (!toolPolicyFactsEqual(baseline.live.toolPolicy, fresh.live.toolPolicy)) {
      try {
        const agent = agentService.getAgent(this.input.agentId)
        if (!agent) return 'invalid'
        if (baseline.live.toolPolicy.permissionMode !== fresh.live.toolPolicy.permissionMode) {
          await this.query.setPermissionMode((fresh.live.toolPolicy.permissionMode ?? 'default') as AgentPermissionMode)
        }
        // Refresh the entire snapshot only after the SDK confirms the permission mode. update()
        // itself changes the snapshot mode, so doing it first would make the SDK call look redundant.
        await this.toolPolicySnapshot?.update(agent)
      } catch (error) {
        logger.warn('Live tool-policy apply failed during reconcile', { sessionId: this.input.sessionId, error })
        return 'failed'
      }
      this.connectionConfig = { ...baseline, live: fresh.live }
      patched = true
    }

    if (baseline.rebuildSignature !== fresh.rebuildSignature) return 'rebuild'
    return patched ? 'patched' : 'current'
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

  async getSupportedCommands(): Promise<AgentSessionSlashCommand[] | null> {
    if (!this.query) return null
    try {
      return await this.query.supportedCommands()
    } catch (error) {
      logger.warn('getSupportedCommands failed', { sessionId: this.input.sessionId, error })
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

        // Mid-session command catalog push (skills discovered in a subdirectory, etc.). Handle it
        // ahead of the no-adapter drop so a primed (turn-less) connection still refreshes its cache.
        if (message.type === 'system' && message.subtype === 'commands_changed') {
          this.eventQueue.push({ type: 'supported-commands', commands: message.commands })
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
          void this.emitContextUsage()
          this.adapter = undefined
          // NOTE: do NOT dispose the approval emitter here. It is session-scoped — it lives across
          // turns on the warm connection and is torn down only on close/error (below). Disposing it
          // per turn evicted the session emitter, so the next turn's `canUseTool` resolved no emitter
          // and denied with "Approval emitter not ready" (the approval never reached the renderer).
          // Steers not injected by the hook this turn (the turn called no tool after they arrived) →
          // hand them back so the host queues them as the next turn (the steer_undelivered fallback).
          this.emitPendingSteersAsUndelivered()
          this.eventQueue.push({ type: 'turn-complete' })
        }
      }
    } catch (error) {
      // The Claude Code SDK sometimes ends the stream abruptly mid-output. When
      // enough text was already buffered, salvage it as a truncated turn (the
      // adapter emits the buffered text + a `truncated` finish through the sink)
      // instead of dropping the partial response and surfacing an error.
      const salvaged = this.adapter?.handleTruncationError(error) ?? false
      if (!salvaged && !this.abortController.signal.aborted) {
        logger.error('Claude Code query loop failed', {
          sessionId: this.input.sessionId,
          modelId: this.adapterModelId ?? this.input.modelId,
          error
        })
      }
      this.adapter = undefined
      // The query stream ended (errored) → the connection is dead; tear the whole session down here
      // rather than relying on a later close() to dispose the steer holder / snapshot.
      this.emitPendingSteersAsUndelivered()
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

  private emitPendingSteersAsUndelivered(): void {
    const undelivered = this.steerHolder?.pending.splice(0) ?? []
    if (undelivered.length > 0) this.eventQueue.push({ type: 'steer-undelivered', inputs: undelivered })
  }

  private bindApprovalEmitter(): void {
    if (!this.approvalEmitter) return
    this.approvalEmitter.emit = (chunk) => this.eventQueue.push({ type: 'chunk', chunk })
  }

  /**
   * Tear down all session-scoped resources. This is the ONLY place they are disposed — wired only to
   * close()/the query-loop error path, never to a turn boundary. Centralising disposal here is what
   * keeps the lifetime correct: there is no per-resource dispose for a turn handler to misplace.
   * Runs ONCE per connection: the second of the close/query-loop-error pair must no-op, because a
   * successor connection for the same session (e.g. after a model edit reconnect) may have registered
   * fresh session-keyed state by then — approval registry entries, tool-policy snapshot — and a
   * repeated by-id dispose would destroy the successor's state, not ours.
   */
  private teardownSession(): void {
    if (this.sessionTornDown) return
    this.sessionTornDown = true
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
    const noCacheTokens = v3Usage.inputTokens.noCache
    const cacheReadTokens = v3Usage.inputTokens.cacheRead
    const cacheWriteTokens = v3Usage.inputTokens.cacheWrite
    this.eventQueue.push({
      type: 'chunk',
      chunk: {
        type: 'message-metadata',
        messageMetadata: {
          totalTokens: promptTokens + completionTokens,
          promptTokens,
          completionTokens,
          ...(reasoningTokens !== undefined ? { thoughtsTokens: reasoningTokens } : {}),
          ...(noCacheTokens !== undefined ? { noCacheTokens } : {}),
          ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
          ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {})
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
        // A successful compaction may report `success` here WITHOUT a following `compact_boundary`
        // (the SDK does not guarantee a boundary). Settle the compacting state idempotently with a
        // no-anchor `compaction-complete` so the session doesn't stay stuck `compacting` until the
        // idle TTL. A real `compact_boundary` (below) still wins by delivering the anchor.
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

async function toSdkUserMessage(
  message: AgentSessionMessageEntity,
  resumeToken?: string,
  systemReminder = false
): Promise<SDKUserMessage> {
  let content = await materializeUserContent(message)
  if (systemReminder) {
    content = applySteerReminder(content)
  }

  return {
    type: 'user',
    message: { role: 'user', content },
    parent_tool_use_id: null,
    session_id: resumeToken ?? ''
  }
}

/**
 * Wrap a steer reminder into user content so the model re-reads the system
 * prompt before its next action. Handles both string and array (text+image)
 * content shapes.
 */
function applySteerReminder(content: SDKUserMessage['message']['content']): SDKUserMessage['message']['content'] {
  if (Array.isArray(content)) {
    let wrappedText = false
    const wrapped = content.map((part) => {
      if (part.type !== 'text' || !part.text.trim()) return part
      wrappedText = true
      return { ...part, text: wrapSteerReminder(part.text) }
    })
    return wrappedText ? wrapped : [{ type: 'text', text: wrapSteerReminder('') }, ...wrapped]
  }
  return content.trim() ? wrapSteerReminder(content) : content
}

/**
 * Build SDK user content from a message entity. Supported image attachments
 * (png, jpeg, gif, webp) are materialized into native Anthropic image blocks;
 * first-party non-image files use the shared extracted-text routing. External
 * files and images that cannot be materialized fall back to local paths when available.
 *
 * **Side effect**: performs file I/O via {@link materializeNativeFilePart}.
 */
async function materializeUserContent(
  message: AgentSessionMessageEntity
): Promise<SDKUserMessage['message']['content']> {
  const parts = message.data?.parts ?? []
  const firstPartyParts = parts.filter(
    (part) => part.type === 'text' || (part.type === 'file' && Boolean(readCherryMeta(part)?.fileEntryId))
  )
  const externalFileParts = parts.filter(
    (part): part is FileUIPart => part.type === 'file' && !readCherryMeta(part)?.fileEntryId
  )
  const originalFirstPartyFiles = new Map(
    firstPartyParts
      .filter((part): part is FileUIPart => part.type === 'file')
      .map((part) => [readCherryMeta(part)?.fileEntryId, part] as const)
      .filter((entry): entry is [string, FileUIPart] => Boolean(entry[0]))
  )

  let routedParts = firstPartyParts
  if (firstPartyParts.some((part) => part.type === 'file')) {
    const userMessage = { id: message.id, role: 'user', parts: firstPartyParts } as CherryUIMessage
    const [prepared] = await prepareChatMessages([userMessage], {
      attachments: collectFileAttachments([userMessage]),
      nativeSupport: { image: true, pdf: false, audio: false, video: false },
      isToolCapable: false
    })
    routedParts = prepared.parts
  }

  const text = routedParts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
  const images: ImageBlockParam[] = []
  const fallbackParts: FileUIPart[] = []
  const unavailableParts: FileUIPart[] = []

  for (const part of [
    ...routedParts.filter((part): part is FileUIPart => part.type === 'file'),
    ...externalFileParts
  ]) {
    const fileEntryId = readCherryMeta(part)?.fileEntryId
    const originalPart = (fileEntryId && originalFirstPartyFiles.get(fileEntryId)) || part
    if (!canBeClaudeImage(part)) {
      const target = originalPart.url?.startsWith('file://') ? fallbackParts : unavailableParts
      target.push(originalPart)
      continue
    }

    const preparedDataUrl = part.url ? parseDataUrl(part.url) : null
    let parsed = preparedDataUrl?.isBase64 ? preparedDataUrl : null
    if (!parsed) {
      const materialized = await materializeNativeFilePart(part)
      if (!materialized) {
        unavailableParts.push(originalPart)
        continue
      }
      parsed = materialized.url ? parseDataUrl(materialized.url) : null
    }

    if (!parsed?.isBase64 || parsed.data.length === 0) {
      unavailableParts.push(originalPart)
      continue
    }

    const claudeType = toClaudeImageMediaType(parsed.mediaType)
    if (claudeType) {
      images.push({
        type: 'image',
        source: { type: 'base64', media_type: claudeType, data: parsed.data }
      })
      continue
    }

    if (originalPart.url?.startsWith('file://')) {
      fallbackParts.push(originalPart)
    } else {
      unavailableParts.push(originalPart)
    }
  }

  const paths = extractAttachmentPaths(fallbackParts)
  let textContent = appendAttachmentPaths(text, paths)
  if (unavailableParts.length > 0) {
    const names = unavailableParts.map((part) => part.filename || 'attachment')
    logger.warn('Claude Code attachments could not be sent', { attachments: names })
    const note = `Unavailable attachments: ${names.join(', ')}`
    textContent = textContent.trim() ? `${textContent}\n\n${note}` : note
  }
  if (images.length === 0) return textContent
  return textContent.trim() ? [{ type: 'text', text: textContent }, ...images] : images
}

function appendAttachmentPaths(text: string, paths: string[]): string {
  if (paths.length === 0) return text

  const list = paths.map((path) => `- ${path}`).join('\n')
  const section = `Attached files (read them with your tools using these absolute paths):\n${list}`
  return text.trim() ? `${text}\n\n${section}` : section
}

/** Absolute local paths of `file://`-backed attachment parts (shared path extraction). */
function extractAttachmentPaths(parts: Array<{ type: string; url?: string }>): string[] {
  const paths: string[] = []
  for (const part of parts) {
    if (part.type !== 'file' || !part.url?.startsWith('file://')) continue
    paths.push(fileURLToPath(part.url))
  }
  return paths
}

function canBeClaudeImage(part: FileUIPart): boolean {
  const mediaType = part.mediaType?.toLowerCase()
  if (!mediaType || mediaType === 'application/octet-stream' || mediaType.startsWith('image/')) return true

  const filename = part.filename?.toLowerCase()
  const url = part.url && !part.url.startsWith('data:') ? part.url.toLowerCase().split(/[?#]/, 1)[0] : undefined
  return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].some(
    (extension) => filename?.endsWith(extension) || url?.endsWith(extension)
  )
}

function toClaudeImageMediaType(value: string | undefined) {
  switch (value?.toLowerCase()) {
    case 'image/jpg':
    case 'image/jpeg':
      return 'image/jpeg'
    case 'image/png':
      return 'image/png'
    case 'image/gif':
      return 'image/gif'
    case 'image/webp':
      return 'image/webp'
    default:
      return null
  }
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
