import { randomUUID } from 'node:crypto'

import type { UIMessageChunk } from 'ai'

import { application } from '@application'
import { remoteLimits } from '@cherrystudio/remote-protocol'
import {
  type AgentCheckpointDescriptor,
  type AgentCheckpointPage,
  type AgentCursor,
  type AgentEvent,
  type AgentExecution,
  type AgentInteraction,
  type AgentPart,
  type AgentProjection,
  applyAgentEvents,
  encodeAgentCheckpointPage
} from '@cherrystudio/remote-protocol/agent'
import { RemoteRpcError } from '@cherrystudio/remote-transport'
import type { DbOrTx } from '@data/db/types'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { loggerService } from '@logger'
import { buildAgentSessionTopicId } from '@main/ai/agentSession/topic'
import { startAgentSessionRun } from '@main/ai/streamManager'
import type { StreamDoneResult, StreamErrorResult, StreamListener, StreamPausedResult } from '@main/ai/streamManager'
import { toExecutionFailure } from '@shared/ai/executionFailure'
import type { CherryMessagePart } from '@shared/data/types/message'

import {
  contentOf,
  getSession,
  INLINE_TEXT_LIMIT,
  inputDigest,
  interactionKind,
  revisionOf,
  sha256,
  toSessionSummary,
  toMessageModel,
  utf8
} from './agentQueries'
import { toMessageUsage } from './agentUsage'

const logger = loggerService.withContext('RemoteAgentJournal')
const integrity = { sha256 }
const APPEND_CHARS = 4096
const PAGE_BYTES = 48_000
const MAX_JOURNALS = 128

type Distribute<T> = T extends unknown ? Omit<T, 'seq'> : never
type PendingEvent = Distribute<AgentEvent>
type CheckpointItem = AgentCheckpointPage['items'][number]
interface Entry {
  event: AgentEvent
  bytes: number
  at: number
}
interface LiveExecution {
  executionId: string
  messageId?: string
  messageIds: Set<string>
  status: AgentExecution['status']
  approvals: Map<string, { toolCallId: string; status: 'pending' | 'approved' | 'denied' }>
  toolInputs: Map<string, { toolName: string; input: unknown }>
}

export interface Checkpoint {
  descriptor: AgentCheckpointDescriptor
  pages: AgentCheckpointPage[]
  content: Map<string, Uint8Array>
}

function textOf(part: AgentPart | undefined): string | undefined {
  const content: unknown = part && 'content' in part ? part.content : undefined
  return typeof content === 'object' && content !== null && 'text' in content && typeof content.text === 'string'
    ? content.text
    : undefined
}

function safeSlice(text: string, max: number): string {
  const sliced = text.slice(0, max)
  return /[\uD800-\uDBFF]$/.test(sliced) ? sliced.slice(0, -1) : sliced
}

function* pieces(text: string): Generator<string> {
  for (let start = 0; start < text.length;) {
    let end = Math.min(text.length, start + APPEND_CHARS)
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end += 1
    yield text.slice(start, end)
    start = end
  }
}

/** One canonical event history per session; every emitted event is applied to the package reducer first. */
export class SessionJournal {
  epoch = randomUUID()
  projection: AgentProjection
  readonly pins = new Map<string, Uint8Array>()
  lastUsedAt = Date.now()
  private starting = 0
  private seq = 0
  private revision = 0
  private entries: Entry[] = []
  private retainedBytes = 0
  private listener?: RemoteAgentListener
  private execution?: LiveExecution
  private readonly interactionInputs = new Map<string, string>()
  private readonly observers = new Set<() => void>()
  private readonly topicId: string

  constructor(
    readonly sessionId: string,
    private readonly onAppend: () => void = () => {}
  ) {
    this.topicId = buildAgentSessionTopicId(sessionId)
    this.projection = this.emptyProjection()
  }

  get replayBytes(): number {
    return this.retainedBytes
  }

  get oldestReplayAt(): number {
    return this.entries[0]?.at ?? Infinity
  }

  get disposable(): boolean {
    return (
      !this.starting &&
      !this.execution &&
      !this.observers.size &&
      !application.get('AiStreamManager').hasLiveStream(this.topicId) &&
      !application.get('AgentSessionRuntimeService').isSessionBusy(this.sessionId)
    )
  }

  trimReplay(maxBytes: number): void {
    while (this.entries.length && this.retainedBytes > maxBytes) this.retainedBytes -= this.entries.shift()!.bytes
  }

  get cursor(): AgentCursor {
    return { sessionId: this.sessionId, streamEpoch: this.epoch, seq: String(this.seq) }
  }
  get firstRetainedSeq(): number {
    return this.entries[0] ? Number(this.entries[0].event.seq) : this.seq + 1
  }
  get activeExecutionId(): string | undefined {
    return this.execution?.executionId
  }
  observe(observer: () => void): () => void {
    this.observers.add(observer)
    return () => this.observers.delete(observer)
  }

  eventsAfter(seq: number, maxBytes: number): AgentEvent[] {
    const events: AgentEvent[] = []
    let bytes = 0
    for (const entry of this.entries) {
      if (Number(entry.event.seq) <= seq) continue
      if (events.length && bytes + entry.bytes > maxBytes) break
      events.push(entry.event)
      bytes += entry.bytes
    }
    return events
  }

  /** Publish the current projection as immutable pages; streaming text above the inline limit is pinned by revision. */
  capture(): Checkpoint {
    const content = new Map<string, Uint8Array>()
    const items: CheckpointItem[] = [{ kind: 'session', value: this.projection.session }]
    for (const value of Object.values(this.projection.executions)) items.push({ kind: 'execution', value })
    for (const value of Object.values(this.projection.messages)) items.push({ kind: 'message', value })
    for (const message of Object.values(this.projection.messages)) {
      for (const partId of message.partIds) {
        let part = this.projection.parts[partId]
        const text = textOf(part)
        if (text !== undefined && text.length > INLINE_TEXT_LIMIT) {
          content.set(`${partId}:${part.revision}`, utf8(text))
          part = { ...part, content: contentOf(partId, part.revision, text) }
        }
        items.push({ kind: 'part', messageId: message.messageId, value: part })
      }
    }
    for (const value of Object.values(this.projection.interactions)) items.push({ kind: 'interaction', value })
    const checkpointId = randomUUID()
    const pages: AgentCheckpointPage[] = []
    const chunks: Uint8Array[] = []
    let current: CheckpointItem[] = []
    const flush = (last: boolean) => {
      const page: AgentCheckpointPage = {
        checkpointId,
        pageIndex: pages.length,
        items: current,
        nextCursor: last ? null : String(pages.length + 1),
        pageDigest: '0'.repeat(64)
      }
      const bytes = encodeAgentCheckpointPage(page)
      page.pageDigest = sha256(bytes)
      pages.push(page)
      chunks.push(bytes)
      current = []
    }
    for (const item of items) {
      if (
        current.length &&
        (current.length >= 100 ||
          encodeAgentCheckpointPage({
            checkpointId,
            pageIndex: 0,
            items: [...current, item],
            nextCursor: null,
            pageDigest: '0'.repeat(64)
          }).length > PAGE_BYTES)
      )
        flush(false)
      current.push(item)
    }
    flush(true)
    const all = Buffer.concat(chunks)
    const descriptor: AgentCheckpointDescriptor = {
      checkpointId,
      cursor: this.cursor,
      historyRevision: this.projection.session.historyRevision,
      pageCount: pages.length,
      byteLength: String(all.length),
      sha256: sha256(all),
      expiresAt: new Date(Date.now() + remoteLimits.checkpointMs).toISOString()
    }
    return { descriptor, pages, content }
  }

  /** Attach to a locally started execution; replay from the owner's buffer fills the projection. */
  poll(): void {
    const manager = application.get('AiStreamManager')
    this.evict()
    if (this.listener?.current || !manager.hasLiveStream(this.topicId)) return
    const listener = new RemoteAgentListener(this, randomUUID())
    this.listener = listener
    this.ensureExecution(listener.executionId)
    if (!manager.addListener(this.topicId, listener)) listener.current = false
  }

  async startRun(
    text: string,
    expectedAgentId: string,
    onPersist: (tx: DbOrTx, reservation: { executionId: string; messageId: string; userMessageId: string }) => void,
    beforePersist?: () => void
  ): Promise<{ started: true; executionId: string } | { started: false; reason: 'busy' | 'session-invalid' }> {
    const listener = new RemoteAgentListener(this, randomUUID())
    const userParts: CherryMessagePart[] = [{ type: 'text', text }]
    this.starting += 1
    try {
      const result = await startAgentSessionRun({
        sessionId: this.sessionId,
        userParts,
        listeners: [listener],
        requireIdle: { expectedAgentId },
        beforePersist,
        onPersist: (tx, messages) =>
          onPersist(tx, {
            executionId: listener.executionId,
            messageId: messages.assistantMessageId,
            userMessageId: messages.userMessageId
          })
      })
      if (result.mode !== 'started') {
        listener.current = false
        return { started: false, reason: result.reason }
      }
      this.listener = listener
      if (listener.current) this.ensureExecution(listener.executionId)
      return { started: true, executionId: listener.executionId }
    } finally {
      this.starting -= 1
      this.lastUsedAt = Date.now()
    }
  }

  ensureExecution(executionId: string): LiveExecution {
    if (this.execution?.executionId === executionId) return this.execution
    this.execution = {
      executionId,
      status: 'running',
      messageIds: new Set(),
      approvals: new Map(),
      toolInputs: new Map()
    }
    this.commitHistory()
    this.append({ kind: 'execution.updated', payload: { executionId, status: 'running', durable: false } })
    this.publishSession()
    return this.execution
  }

  liveInteraction(interactionId: string): { messageId: string; executionId: string; toolCallId: string } | undefined {
    const approval = this.execution?.approvals.get(interactionId)
    return approval && this.execution?.messageId
      ? {
          messageId: this.execution.messageId,
          executionId: this.execution.executionId,
          toolCallId: approval.toolCallId
        }
      : undefined
  }

  /** Live approvals with their full input; persisted approval cards are listed by agentQueries. */
  interactions(): AgentInteraction[] {
    return Object.values(this.projection.interactions).map((summary) => {
      const approval = this.execution?.approvals.get(summary.interactionId)
      const input =
        this.interactionInputs.get(summary.interactionId) ??
        JSON.stringify(this.execution?.toolInputs.get(approval?.toolCallId ?? '')?.input ?? null)
      const contentId = `${this.execution?.messageId ?? summary.executionId}:approval:${summary.interactionId}`
      if (input.length > INLINE_TEXT_LIMIT) this.pins.set(`${contentId}:${summary.revision}`, utf8(input))
      return { ...summary, input: contentOf(contentId, summary.revision, input) }
    })
  }

  markInteraction(interactionId: string, status: 'approved' | 'denied'): void {
    const approval = this.execution?.approvals.get(interactionId)
    const current = this.projection.interactions[interactionId]
    if (!approval || !current || approval.status !== 'pending') return
    approval.status = status
    this.append({ kind: 'interaction.updated', payload: { ...current, revision: this.next(), status } })
  }

  onChunk(listener: RemoteAgentListener, chunk: UIMessageChunk, anchorMessageId?: string): void {
    const execution = this.ensureExecution(listener.executionId)
    const messageId = this.ensureMessage(
      execution,
      anchorMessageId ?? (chunk.type === 'start' ? chunk.messageId : undefined)
    )
    switch (chunk.type) {
      case 'text-start':
      case 'reasoning-start':
        this.createPart(messageId, {
          partId: `${messageId}:${chunk.type === 'text-start' ? 'text' : 'reasoning'}:${chunk.id}`,
          revision: this.next(),
          executionId: execution.executionId,
          kind: chunk.type === 'text-start' ? 'text' : 'reasoning',
          content: { text: '' },
          state: 'streaming'
        })
        return
      case 'text-delta':
      case 'reasoning-delta': {
        const kind = chunk.type === 'text-delta' ? 'text' : 'reasoning'
        const partId = `${messageId}:${kind}:${chunk.id}`
        if (!this.projection.parts[partId])
          this.createPart(messageId, {
            partId,
            revision: this.next(),
            executionId: execution.executionId,
            kind,
            content: { text: '' },
            state: 'streaming'
          })
        this.appendText(messageId, partId, chunk.delta)
        return
      }
      case 'text-end':
      case 'reasoning-end':
        this.completePart(messageId, `${messageId}:${chunk.type === 'text-end' ? 'text' : 'reasoning'}:${chunk.id}`)
        return
      case 'tool-input-start':
        this.createPart(messageId, {
          partId: `${messageId}:tool:${chunk.toolCallId}:in`,
          revision: this.next(),
          executionId: execution.executionId,
          toolCallId: chunk.toolCallId,
          kind: 'tool-input',
          toolName: chunk.toolName,
          content: { text: '' },
          state: 'streaming'
        })
        return
      case 'tool-input-delta':
        this.appendText(messageId, `${messageId}:tool:${chunk.toolCallId}:in`, chunk.inputTextDelta)
        return
      case 'tool-input-available':
      case 'tool-input-error': {
        execution.toolInputs.set(chunk.toolCallId, { toolName: chunk.toolName, input: chunk.input })
        this.replaceTool(
          messageId,
          `${messageId}:tool:${chunk.toolCallId}:in`,
          chunk.toolName,
          chunk.toolCallId,
          'tool-input',
          JSON.stringify(chunk.input ?? null),
          'completed'
        )
        if (chunk.type === 'tool-input-error')
          this.replaceTool(
            messageId,
            `${messageId}:tool:${chunk.toolCallId}:out`,
            chunk.toolName,
            chunk.toolCallId,
            'tool-output',
            JSON.stringify(chunk.errorText),
            'failed'
          )
        return
      }
      case 'tool-output-available':
      case 'tool-output-error':
      case 'tool-output-denied': {
        const input = execution.toolInputs.get(chunk.toolCallId)
        const failed = chunk.type !== 'tool-output-available'
        const text = JSON.stringify(
          chunk.type === 'tool-output-available'
            ? (chunk.output ?? null)
            : chunk.type === 'tool-output-error'
              ? chunk.errorText
              : 'denied'
        )
        this.replaceTool(
          messageId,
          `${messageId}:tool:${chunk.toolCallId}:out`,
          input?.toolName ?? 'tool',
          chunk.toolCallId,
          'tool-output',
          text,
          failed ? 'failed' : 'completed'
        )
        for (const [approvalId, approval] of execution.approvals) {
          if (approval.toolCallId === chunk.toolCallId)
            this.markInteraction(approvalId, chunk.type === 'tool-output-denied' ? 'denied' : 'approved')
        }
        if (
          execution.status === 'awaiting-approval' &&
          ![...execution.approvals.values()].some((approval) => approval.status === 'pending')
        )
          this.setStatus(execution, 'running')
        return
      }
      case 'tool-approval-request': {
        const input = execution.toolInputs.get(chunk.toolCallId)
        this.interactionInputs.set(chunk.approvalId, JSON.stringify(input?.input ?? null))
        execution.approvals.set(chunk.approvalId, { toolCallId: chunk.toolCallId, status: 'pending' })
        this.append({
          kind: 'interaction.updated',
          payload: {
            interactionId: chunk.approvalId,
            kind: interactionKind(input?.toolName),
            revision: this.next(),
            executionId: execution.executionId,
            toolCallId: chunk.toolCallId,
            status: 'pending',
            summary: safeSlice(`${input?.toolName ?? 'tool'} ${JSON.stringify(input?.input ?? null)}`, 2048),
            inputDigest: inputDigest(input?.input)
          }
        })
        this.setStatus(execution, 'awaiting-approval')
        return
      }
      case 'file':
        this.createPart(messageId, {
          partId: `${messageId}:file:${this.next()}`,
          revision: this.next(),
          executionId: execution.executionId,
          kind: 'data',
          name: 'file',
          content: { text: JSON.stringify({ mediaType: chunk.mediaType }) }
        })
        return
      case 'source-url':
      case 'source-document':
        this.createPart(messageId, {
          partId: `${messageId}:source:${chunk.sourceId}`,
          revision: this.next(),
          executionId: execution.executionId,
          kind: 'data',
          name: chunk.type,
          content: { text: safeSlice(JSON.stringify(chunk), INLINE_TEXT_LIMIT) }
        })
        return
      case 'error':
        return
      default:
        return
    }
  }

  onTerminal(listener: RemoteAgentListener, result: StreamDoneResult | StreamPausedResult | StreamErrorResult): void {
    if (
      !listener.current ||
      result.isTopicDone === false ||
      (this.execution && this.execution.executionId !== listener.executionId)
    )
      return
    const execution = this.ensureExecution(listener.executionId)
    listener.current = false
    const saved = result.persistence?.status === 'saved' ? result.persistence.message : undefined
    const anchor = saved?.messageId ?? result.finalMessage?.id ?? result.anchorMessageId ?? execution.messageId
    if (!anchor) throw new Error('Terminal execution has no assistant message identity')
    const messageId = this.ensureMessage(execution, anchor)
    const failure =
      result.status === 'error' ? (result.failure ?? toExecutionFailure(result.error, result.modelId)) : undefined
    const persistenceFailure =
      result.persistence?.status === 'failed'
        ? result.persistence.failure
        : saved
          ? undefined
          : toExecutionFailure(
              { name: 'PersistenceError', message: 'Execution result was not saved', stack: null },
              result.modelId,
              'host'
            )
    const stored = saved ? agentSessionMessageService.getSessionMessage(this.sessionId, messageId) : undefined
    const stats = stored
      ? stored.stats
      : {
          ...result.finalMessage?.metadata?.stats,
          ...(result.runtimeTiming ? { runtimeTiming: result.runtimeTiming } : {})
        }
    const model = toMessageModel(
      stored ?? {
        modelId: result.modelId ?? result.finalMessage?.metadata?.modelId,
        messageSnapshot: result.finalMessage?.metadata?.messageSnapshot
      }
    )
    const usage = toMessageUsage(stats)
    const status = result.status === 'success' ? 'completed' : result.status === 'paused' ? 'cancelled' : 'failed'
    const message = this.projection.messages[messageId]
    if (message)
      this.append({
        kind: 'message.updated',
        payload: {
          baseRevision: message.revision,
          message: {
            ...message,
            revision: this.next(),
            ...(usage ? { usage } : {}),
            ...(model ? { model } : {}),
            status: result.status === 'error' ? 'error' : result.status === 'paused' ? 'paused' : 'success',
            ...(failure ? { failure } : {})
          }
        }
      })
    this.append({
      kind: 'execution.updated',
      payload: {
        executionId: execution.executionId,
        status,
        messageId,
        durable: Boolean(saved),
        ...(saved
          ? { history: { messageRevision: saved.messageRevision, historyRevision: saved.historyRevision } }
          : {}),
        ...(persistenceFailure ? { persistenceFailure } : {}),
        ...(failure ? { failure, error: { reason: 'INTERNAL', message: safeSlice(failure.message, 512) } } : {})
      }
    })
    const committed = saved ? this.commitHistory() : new Set<string>()
    if (saved) committed.add(saved.messageId)
    this.execution = undefined
    for (const [approvalId, approval] of execution.approvals) {
      const current = this.projection.interactions[approvalId]
      if (approval.status === 'pending' && current)
        this.append({ kind: 'interaction.updated', payload: { ...current, revision: this.next(), status: 'expired' } })
    }
    for (const messageId of execution.messageIds) {
      if (!committed.has(messageId)) continue
      const message = this.projection.messages[messageId]
      if (!message) continue
      this.append({
        kind: 'message.removed',
        payload: { messageId, baseRevision: message.revision, revision: this.next() }
      })
      for (const key of this.pins.keys()) if (key.startsWith(`${messageId}:`)) this.pins.delete(key)
    }
    this.publishSession()
  }

  dispose(): void {
    if (this.listener) this.listener.current = false
    this.observers.clear()
  }

  private next(): string {
    return String(++this.revision)
  }

  private emptyProjection(): AgentProjection {
    const session = toSessionSummary(getSession(this.sessionId), this.execution?.executionId)
    if (!session) throw new RemoteRpcError('NOT_FOUND', 'Session has no agent')
    return {
      cursor: { sessionId: this.sessionId, streamEpoch: this.epoch, seq: '0' },
      session,
      executions: {},
      messages: {},
      parts: {},
      interactions: {},
      tombstones: []
    }
  }

  private publishSession(): void {
    const session = toSessionSummary(getSession(this.sessionId), this.execution?.executionId)
    if (session)
      this.append({
        kind: 'session.updated',
        payload: { ...session, historyRevision: this.projection.session.historyRevision }
      })
  }

  /** Durable rows changed since the last committed revision; the session's updatedAt is the history revision. */
  private commitHistory(): Set<string> {
    const session = getSession(this.sessionId)
    const previous = Number(this.projection.session.historyRevision)
    const historyRevision = revisionOf(session.updatedAt)
    if (Number(historyRevision) <= previous) return new Set()
    const messages = agentSessionMessageService
      .listSessionMessages(this.sessionId, { limit: 50 })
      .items.filter((message) => Date.parse(message.updatedAt) > previous)
    this.append({
      kind: 'history.committed',
      payload: {
        historyRevision,
        ...(this.execution ? { executionId: this.execution.executionId } : {}),
        messages: messages.map((message) => ({ messageId: message.id, revision: revisionOf(message.updatedAt) }))
      }
    })
    return new Set(messages.map((message) => message.id))
  }

  private ensureMessage(execution: LiveExecution, messageId?: string): string {
    if (execution.messageId && (!messageId || messageId === execution.messageId)) return execution.messageId
    const id = messageId ?? randomUUID()
    execution.messageId = id
    execution.messageIds.add(id)
    if (!this.projection.messages[id] && !this.projection.tombstones.includes(id))
      this.append({
        kind: 'message.created',
        payload: { messageId: id, revision: this.next(), role: 'assistant', partIds: [], status: 'pending' }
      })
    this.append({
      kind: 'execution.updated',
      payload: { executionId: execution.executionId, status: execution.status, messageId: id, durable: false }
    })
    return id
  }

  private setStatus(execution: LiveExecution, status: AgentExecution['status']): void {
    execution.status = status
    this.append({
      kind: 'execution.updated',
      payload: {
        executionId: execution.executionId,
        status,
        durable: false,
        ...(execution.messageId ? { messageId: execution.messageId } : {})
      }
    })
  }

  private createPart(messageId: string, part: AgentPart): void {
    const message = this.projection.messages[messageId]
    if (!message || this.projection.parts[part.partId]) return
    this.append({
      kind: 'part.created',
      payload: {
        messageId,
        afterPartId: message.partIds.at(-1) ?? null,
        messageBaseRevision: message.revision,
        messageRevision: this.next(),
        part
      }
    })
  }

  private appendText(messageId: string, partId: string, delta: string): void {
    for (const piece of pieces(delta)) {
      const part = this.projection.parts[partId]
      const text = textOf(part)
      if (!part || text === undefined || !('state' in part) || part.state !== 'streaming') return
      this.append({
        kind: 'part.append',
        payload: {
          messageId,
          partId,
          baseRevision: part.revision,
          revision: this.next(),
          offsetUtf8: String(utf8(text).length),
          text: piece
        }
      })
    }
  }

  private completePart(messageId: string, partId: string): void {
    const part = this.projection.parts[partId]
    const text = textOf(part)
    if (!part || text === undefined || !('state' in part) || part.state !== 'streaming') return
    const bytes = utf8(text)
    this.append({
      kind: 'part.completed',
      payload: {
        messageId,
        partId,
        baseRevision: part.revision,
        revision: this.next(),
        byteLength: String(bytes.length),
        sha256: sha256(bytes)
      }
    })
  }

  private replaceTool(
    messageId: string,
    partId: string,
    toolName: string,
    toolCallId: string,
    kind: 'tool-input' | 'tool-output',
    text: string,
    state: 'completed' | 'failed'
  ): void {
    const revision = this.next()
    if (text.length > INLINE_TEXT_LIMIT) this.pins.set(`${partId}:${revision}`, utf8(text))
    const content = contentOf(partId, revision, text)
    const executionId = this.execution?.executionId
    const part: AgentPart =
      kind === 'tool-input'
        ? { partId, revision, executionId, toolCallId, kind, toolName, content, state: 'completed' }
        : { partId, revision, executionId, toolCallId, kind, toolName, content, state }
    const existing = this.projection.parts[partId]
    if (existing) this.append({ kind: 'part.replaced', payload: { messageId, baseRevision: existing.revision, part } })
    else this.createPart(messageId, part)
  }

  private append(pending: PendingEvent): void {
    const event: AgentEvent = { ...pending, seq: String(this.seq + 1) }
    const result = applyAgentEvents(
      this.projection,
      { subscriptionId: 'journal', sessionId: this.sessionId, streamEpoch: this.epoch, events: [event] },
      {},
      integrity
    )
    if (!result.ok) {
      logger.error('Remote journal rejected its own event; starting a new epoch', {
        sessionId: this.sessionId,
        kind: event.kind,
        reason: result.reason
      })
      this.reset()
      return
    }
    this.projection = result.projection
    this.seq += 1
    const bytes = utf8(JSON.stringify(event)).length
    this.entries.push({ event, bytes, at: Date.now() })
    this.retainedBytes += bytes
    this.lastUsedAt = Date.now()
    this.evict()
    this.onAppend()
    for (const observer of this.observers) observer()
  }

  private reset(): void {
    this.epoch = randomUUID()
    this.seq = 0
    this.entries = []
    this.retainedBytes = 0
    this.pins.clear()
    this.interactionInputs.clear()
    this.projection = this.emptyProjection()
    for (const observer of this.observers) observer()
  }

  private evict(): void {
    const cutoff = Date.now() - remoteLimits.replayMs
    while (this.entries.length && (this.retainedBytes > remoteLimits.replayBytes || this.entries[0].at < cutoff)) {
      this.retainedBytes -= this.entries.shift()!.bytes
    }
  }
}

class RemoteAgentListener implements StreamListener {
  readonly id: string
  readonly terminalPhase = 'cleanup' as const
  current = true

  constructor(
    private readonly journal: SessionJournal,
    readonly executionId: string
  ) {
    this.id = `remote:${executionId}`
  }

  onChunk(chunk: UIMessageChunk, _sourceModelId?: unknown, anchorMessageId?: string): void {
    if (this.current) this.guard(() => this.journal.onChunk(this, chunk, anchorMessageId))
  }
  onDone(result: StreamDoneResult): void {
    this.guard(() => this.journal.onTerminal(this, result))
  }
  onPaused(result: StreamPausedResult): void {
    this.guard(() => this.journal.onTerminal(this, result))
  }
  onError(result: StreamErrorResult): void {
    this.guard(() => this.journal.onTerminal(this, result))
  }
  private guard(fn: () => void): void {
    try {
      fn()
    } catch (error) {
      this.current = false
      logger.error('Remote journal projection failed', error as Error)
    }
  }
  isAlive(): boolean {
    return this.current
  }
}

/** Shared journals: one per session regardless of how many devices subscribe. */
export class RemoteAgentHub {
  private readonly journals = new Map<string, SessionJournal>()

  journal(sessionId: string): SessionJournal {
    let journal = this.journals.get(sessionId)
    if (!journal) {
      if (this.journals.size >= MAX_JOURNALS) {
        const oldest = [...this.journals.values()]
          .filter((value) => value.disposable)
          .sort((a, b) => a.lastUsedAt - b.lastUsedAt)[0]
        if (!oldest) throw new RemoteRpcError('RESOURCE_EXHAUSTED', 'Too many retained session journals')
        oldest.dispose()
        this.journals.delete(oldest.sessionId)
      }
      journal = new SessionJournal(sessionId, () => this.enforceReplayBudget())
      this.journals.set(sessionId, journal)
    }
    journal.lastUsedAt = Date.now()
    journal.poll()
    return journal
  }

  activeExecutionId(sessionId: string): string | undefined {
    const journal = this.journals.get(sessionId)
    if (journal) return journal.activeExecutionId
    const busy =
      application.get('AiStreamManager').hasLiveStream(buildAgentSessionTopicId(sessionId)) ||
      application.get('AgentSessionRuntimeService').isSessionBusy(sessionId)
    return busy ? this.journal(sessionId).activeExecutionId : undefined
  }

  sweep(): void {
    for (const journal of this.journals.values()) {
      if (journal.disposable && journal.lastUsedAt <= Date.now() - remoteLimits.replayMs) {
        journal.dispose()
        this.journals.delete(journal.sessionId)
      } else journal.poll()
    }
  }

  private enforceReplayBudget(): void {
    const journals = [...this.journals.values()].sort((a, b) => a.oldestReplayAt - b.oldestReplayAt)
    let excess = journals.reduce((bytes, journal) => bytes + journal.replayBytes, 0) - remoteLimits.globalReplayBytes
    for (const journal of journals) {
      if (excess <= 0) break
      const before = journal.replayBytes
      journal.trimReplay(Math.max(0, before - excess))
      excess -= before - journal.replayBytes
    }
  }

  dispose(): void {
    for (const journal of this.journals.values()) journal.dispose()
    this.journals.clear()
  }
}
