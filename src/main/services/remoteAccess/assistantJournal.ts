import { randomUUID } from 'node:crypto'

import { application } from '@application'
import { remoteLimits } from '@cherrystudio/remote-protocol'
import type { AgentExecution, AgentPart } from '@cherrystudio/remote-protocol/agent'
import {
  assistantEventSchema,
  encodeAssistantCheckpointPage,
  type AssistantCheckpointDescriptor,
  type AssistantCheckpointItem,
  type AssistantCheckpointPage,
  type AssistantCursor,
  type AssistantEvent,
  type AssistantMessage
} from '@cherrystudio/remote-protocol/assistant'
import { RemoteRpcError } from '@cherrystudio/remote-transport'
import { messageService } from '@data/services/MessageService'
import { loggerService } from '@logger'
import type { StreamDoneResult, StreamErrorResult, StreamListener, StreamPausedResult } from '@main/ai/streamManager'
import { finalizeInterruptedParts } from '@main/ai/streamManager'
import { toExecutionFailure } from '@shared/ai/executionFailure'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'

import { contentOf, projectPersistedParts, sha256, utf8 } from './agentQueries'
import { getAssistantTopic, persistedAssistantInteractions, toAssistantMessage } from './assistantQueries'

const logger = loggerService.withContext('RemoteAssistantJournal')
type PendingEvent = AssistantEvent extends infer T ? (T extends AssistantEvent ? Omit<T, 'seq'> : never) : never
type Terminal = StreamDoneResult | StreamPausedResult | StreamErrorResult
export interface AssistantCheckpoint {
  descriptor: AssistantCheckpointDescriptor
  pages: AssistantCheckpointPage[]
  content: Map<string, Uint8Array>
}

export class TopicJournal implements StreamListener {
  readonly id = `remote-assistant:${randomUUID()}`
  readonly terminalPhase = 'cleanup' as const
  epoch = randomUUID()
  lastUsedAt = Date.now()
  private seq = 0
  private revision = 0
  private alive = true
  private timer?: ReturnType<typeof setTimeout>
  private topic: ReturnType<typeof getAssistantTopic>
  private readonly observers = new Set<() => void>()
  private readonly entries: Array<{ event: AssistantEvent; bytes: number; at: number }> = []
  private retainedBytes = 0
  private readonly executions = new Map<string, AgentExecution>()
  private readonly identities = new Map<number, string>()
  private readonly reservations = new Map<string, string>()
  private readonly messages = new Map<string, AssistantMessage>()
  private readonly parts = new Map<string, { messageId: string; part: AgentPart; text: string }>()
  private readonly pins = new Map<string, { bytes: Uint8Array; seq: number }>()

  constructor(
    readonly topicId: string,
    private readonly onAppend: () => void
  ) {
    this.topic = getAssistantTopic(topicId)
  }

  get cursor(): AssistantCursor {
    return { topicId: this.topicId, streamEpoch: this.epoch, seq: String(this.seq) }
  }
  get firstRetainedSeq(): number {
    return this.entries[0] ? Number(this.entries[0].event.seq) : this.seq + 1
  }
  get replayBytes(): number {
    return this.retainedBytes + [...this.pins.values()].reduce((bytes, item) => bytes + item.bytes.length, 0)
  }
  get disposable(): boolean {
    return !this.observers.size && !application.get('AiStreamManager').hasUnsettledTopicWork(this.topicId)
  }

  reserve(messageId: string, executionId: string): void {
    this.reservations.set(messageId, executionId)
  }

  activeExecutionIds(): string[] {
    const snapshot = application.get('AiStreamManager').inspect(this.topicId)
    return (
      snapshot?.executions
        .filter((execution) => execution.status === 'streaming')
        .map((execution) => this.executionId(execution.attemptId, execution.anchorMessageId)) ?? []
    )
  }

  private executionId(attemptId: number, messageId?: string): string {
    let id = this.identities.get(attemptId)
    if (!id) {
      id = (messageId && this.reservations.get(messageId)) || `${this.epoch}:${attemptId}`
      this.identities.set(attemptId, id)
      if (messageId) this.reservations.delete(messageId)
    }
    return id
  }

  poll(): void {
    this.flush()
    this.trimReplay(remoteLimits.replayBytes)
  }

  onChunk(): void {
    if (this.timer || !this.alive) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.guard(() => this.flush())
    }, 50)
    this.timer.unref()
  }
  onDone(result: StreamDoneResult): void {
    this.guard(() => this.terminal(result))
  }
  onPaused(result: StreamPausedResult): void {
    this.guard(() => this.terminal(result))
  }
  onError(result: StreamErrorResult): void {
    this.guard(() => this.terminal(result))
  }
  isAlive(): boolean {
    return this.alive
  }

  private flush(): void {
    const manager = application.get('AiStreamManager')
    const snapshot = manager.inspect(this.topicId)
    if (manager.hasLiveStream(this.topicId) && !snapshot?.listenerIds.includes(this.id))
      manager.addListener(this.topicId, this)
    for (const execution of snapshot?.executions ?? []) {
      if (!execution.anchorMessageId) continue
      const executionId = this.executionId(execution.attemptId, execution.anchorMessageId)
      const prior = this.executions.get(executionId)
      if (execution.status !== 'streaming' && !prior) continue
      if (prior?.durable || ['completed', 'cancelled', 'failed', 'interrupted'].includes(prior?.status ?? '')) continue
      const next: AgentExecution = {
        executionId,
        messageId: execution.anchorMessageId,
        status: execution.status === 'streaming' ? 'running' : 'finalizing',
        durable: false
      }
      if (JSON.stringify(prior) !== JSON.stringify(next)) {
        this.executions.set(executionId, next)
        this.append({ kind: 'execution.updated', execution: next })
      }
      if (execution.finalMessage)
        this.publishMessage(execution.anchorMessageId, execution.finalMessage, executionId, execution.modelId)
    }
    this.publishTopic()
  }

  private publishMessage(
    messageId: string,
    snapshot: CherryUIMessage,
    executionId: string,
    modelId?: UniqueModelId,
    terminal?: Terminal
  ): void {
    const stored = messageService.getById(messageId)
    if (stored.topicId !== this.topicId) throw new RemoteRpcError('NOT_FOUND', 'Message moved outside this topic')
    const source = {
      ...stored,
      data: {
        ...stored.data,
        parts: terminal ? finalizeInterruptedParts(snapshot.parts, terminal.status) : snapshot.parts
      },
      modelId: snapshot.metadata?.modelId ?? modelId ?? stored.modelId,
      stats: snapshot.metadata?.stats ?? stored.stats,
      status: terminal?.status ?? ('pending' as const)
    }
    const projected = projectPersistedParts(source, String(this.revision), false)
    const revision = this.nextRevision()
    const message = {
      ...toAssistantMessage(source, revision, projected.length),
      ...(terminal?.status === 'error'
        ? { failure: terminal.failure ?? toExecutionFailure(terminal.error, terminal.modelId) }
        : {}),
      partIds: projected.map(({ part }) => `${messageId}:live:${part.partId.slice(messageId.length + 1)}`)
    }
    const priorMessage = this.messages.get(messageId)
    if (!priorMessage || JSON.stringify({ ...priorMessage, revision }) !== JSON.stringify(message)) {
      this.messages.set(messageId, message)
      this.append({ kind: 'message.updated', message: { ...message, partIds: [] } })
    }
    const ids = new Set(message.partIds)
    for (const [id, item] of this.parts) {
      if (item.messageId === messageId && !ids.has(id)) {
        this.parts.delete(id)
        this.append({ kind: 'part.removed', messageId, partId: id })
      }
    }
    for (const [index, projectedPart] of projected.entries()) {
      const partId = `${messageId}:live:${projectedPart.part.partId.slice(messageId.length + 1)}`
      const afterPartId = message.partIds[index - 1] ?? null
      const prior = this.parts.get(partId)
      const text = projectedPart.text
      const original = projectedPart.part
      const oldShape = Object.fromEntries(
        Object.entries(prior?.part ?? {}).filter(([key]) => key !== 'revision' && key !== 'content')
      )
      const shape = Object.fromEntries(
        Object.entries(original).filter(([key]) => key !== 'revision' && key !== 'content')
      )
      if (
        prior &&
        prior.text === text &&
        JSON.stringify({ ...oldShape, partId: original.partId }) === JSON.stringify({ ...shape, executionId })
      )
        continue
      let part: AgentPart = { ...original, partId, revision: this.nextRevision(), executionId }
      if ('content' in part) part = { ...part, content: contentOf(partId, part.revision, text) }
      const canAppend =
        prior &&
        (part.kind === 'text' || part.kind === 'reasoning') &&
        prior.part.kind === part.kind &&
        prior.part.executionId === executionId &&
        text.startsWith(prior.text) &&
        text.length > prior.text.length
      let replaced = !canAppend
      if (canAppend && prior) {
        let previousRevision = prior.part.revision
        let offset = utf8(prior.text).length
        for (let start = prior.text.length; start < text.length;) {
          let end = Math.min(text.length, start + 2048)
          if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1
          const delta = text.slice(start, end)
          const nextRevision = this.nextRevision()
          this.append({
            kind: 'part.append',
            messageId,
            partId,
            baseRevision: previousRevision,
            revision: nextRevision,
            offsetUtf8: String(offset),
            text: delta
          })
          previousRevision = nextRevision
          offset += utf8(delta).length
          start = end
        }
        part = { ...part, revision: previousRevision, content: contentOf(partId, previousRevision, text) }
        if ('state' in prior.part && 'state' in part && prior.part.state !== part.state) {
          this.append({ kind: 'part.updated', messageId, afterPartId, part })
          replaced = true
        }
      } else this.append({ kind: 'part.updated', messageId, afterPartId, part })
      if (replaced && part.kind !== 'file' && 'ref' in part.content)
        this.pins.set(`${partId}:${part.revision}`, { bytes: utf8(text), seq: this.seq })
      this.parts.set(partId, { messageId, part, text })
      this.trimReplay(remoteLimits.replayBytes)
      this.onAppend()
    }
  }

  private terminal(result: Terminal): void {
    const messageId =
      result.persistence?.status === 'saved'
        ? result.persistence.message.messageId
        : (result.anchorMessageId ?? result.finalMessage?.id)
    if (!messageId || result.attemptId === undefined) return
    const executionId = this.executionId(result.attemptId, messageId)
    if (result.finalMessage) this.publishMessage(messageId, result.finalMessage, executionId, result.modelId, result)
    const saved = result.persistence?.status === 'saved' ? result.persistence.message : undefined
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
    const execution: AgentExecution = {
      executionId,
      messageId,
      status: result.status === 'success' ? 'completed' : result.status === 'paused' ? 'cancelled' : 'failed',
      durable: Boolean(saved),
      ...(saved ? { history: { historyRevision: saved.historyRevision, messageRevision: saved.messageRevision } } : {}),
      ...(failure ? { failure } : {}),
      ...(persistenceFailure ? { persistenceFailure } : {})
    }
    this.executions.set(executionId, execution)
    this.append({ kind: 'execution.updated', execution })
    if (saved) {
      this.messages.delete(messageId)
      for (const [id, part] of this.parts) if (part.messageId === messageId) this.parts.delete(id)
      this.append({ kind: 'message.removed', messageId })
    }
    for (const interaction of persistedAssistantInteractions(this.topicId))
      this.append({ kind: 'interaction.updated', interaction })
    this.publishTopic()
    if (this.executions.size > 100) {
      for (const [id, item] of this.executions) {
        if (this.executions.size <= 100) break
        if (item.durable) this.executions.delete(id)
      }
    }
  }

  private publishTopic(): void {
    const topic = getAssistantTopic(this.topicId, this.activeExecutionIds())
    if (JSON.stringify(topic) !== JSON.stringify(this.topic)) {
      this.topic = topic
      this.append({ kind: 'topic.updated', topic })
    }
  }

  private nextRevision(): string {
    return String(++this.revision)
  }
  private append(pending: PendingEvent): void {
    const event = assistantEventSchema.parse({ ...pending, seq: String(this.seq + 1) })
    const bytes = Buffer.byteLength(JSON.stringify(event))
    if (bytes > remoteLimits.eventBatchBytes - 1024)
      throw new RemoteRpcError('RESOURCE_EXHAUSTED', 'Assistant event exceeds the record limit')
    this.seq += 1
    this.entries.push({ event, bytes, at: Date.now() })
    this.retainedBytes += bytes
    this.trimReplay(remoteLimits.replayBytes)
    this.onAppend()
    for (const observer of this.observers) observer()
  }
  observe(fn: () => void): () => void {
    this.observers.add(fn)
    return () => this.observers.delete(fn)
  }
  eventsAfter(seq: number, maxBytes: number): AssistantEvent[] {
    const result: AssistantEvent[] = []
    let bytes = 0
    for (const item of this.entries) {
      if (Number(item.event.seq) <= seq) continue
      if (result.length && (bytes + item.bytes > maxBytes || result.length >= 256)) break
      result.push(item.event)
      bytes += item.bytes
    }
    return result
  }
  trimReplay(maxBytes: number): void {
    while (
      this.entries.length &&
      (this.replayBytes > maxBytes || this.entries[0].at < Date.now() - remoteLimits.replayMs)
    ) {
      this.retainedBytes -= this.entries.shift()!.bytes
      for (const [key, item] of this.pins) if (item.seq < this.firstRetainedSeq) this.pins.delete(key)
    }
  }

  capture(): AssistantCheckpoint {
    this.flush()
    const items: AssistantCheckpointItem[] = [{ kind: 'topic', value: this.topic }]
    for (const value of this.executions.values()) items.push({ kind: 'execution', value })
    const content = new Map<string, Uint8Array>()
    for (const message of this.messages.values()) {
      items.push({ kind: 'message', value: { ...message, partIds: [] } })
      for (const partId of message.partIds) {
        const { part, text } = this.parts.get(partId)!
        if (part.kind !== 'file' && 'ref' in part.content) content.set(`${part.partId}:${part.revision}`, utf8(text))
        items.push({ kind: 'part', messageId: message.messageId, value: part })
      }
    }
    for (const value of persistedAssistantInteractions(this.topicId)) items.push({ kind: 'interaction', value })
    const checkpointId = randomUUID()
    const pages: AssistantCheckpointPage[] = []
    let current: AssistantCheckpointItem[] = []
    let bytes = 0
    const flush = () => {
      pages.push({
        checkpointId,
        pageIndex: pages.length,
        items: current,
        nextCursor: null,
        pageDigest: '0'.repeat(64)
      })
      current = []
      bytes = 0
    }
    for (const item of items) {
      const size = Buffer.byteLength(JSON.stringify(item))
      if (size > 48_000) throw new RemoteRpcError('RESOURCE_EXHAUSTED', 'Assistant snapshot exceeds the record limit')
      if (current.length && (bytes + size > 48_000 || current.length >= 100)) flush()
      current.push(item)
      bytes += size
    }
    flush()
    const chunks: Uint8Array[] = []
    for (let index = 0; index < pages.length; index++) {
      pages[index].nextCursor = index + 1 < pages.length ? String(index + 1) : null
      const encoded = encodeAssistantCheckpointPage(pages[index])
      pages[index].pageDigest = sha256(encoded)
      chunks.push(encoded)
    }
    const all = Buffer.concat(chunks)
    return {
      descriptor: {
        checkpointId,
        cursor: this.cursor,
        historyRevision: this.topic.historyRevision,
        pageCount: pages.length,
        byteLength: String(all.length),
        sha256: sha256(all),
        expiresAt: new Date(Date.now() + remoteLimits.checkpointMs).toISOString()
      },
      pages,
      content
    }
  }

  readContent(contentId: string, revision: string): Uint8Array | undefined {
    const pinned = this.pins.get(`${contentId}:${revision}`)?.bytes
    if (pinned) return pinned
    const item = this.parts.get(contentId)
    return item?.part.revision === revision ? utf8(item.text) : undefined
  }
  dispose(): void {
    this.alive = false
    this.epoch = randomUUID()
    if (this.timer) clearTimeout(this.timer)
    application.get('AiStreamManager').removeListener(this.topicId, this.id)
    this.observers.clear()
    this.pins.clear()
  }
  private guard(fn: () => void): void {
    try {
      fn()
    } catch (error) {
      logger.warn('Assistant stream projection failed', { topicId: this.topicId, error })
      this.epoch = randomUUID()
      this.seq = 0
      this.entries.length = 0
      this.retainedBytes = 0
      this.pins.clear()
      for (const observer of this.observers) observer()
    }
  }
}

export class RemoteAssistantHub {
  private readonly journals = new Map<string, TopicJournal>()
  constructor(private readonly onAppend: () => void = () => {}) {}
  get replayBytes(): number {
    return [...this.journals.values()].reduce((bytes, journal) => bytes + journal.replayBytes, 0)
  }
  trimReplay(maxBytes: number): void {
    this.enforceBudget(maxBytes)
  }
  journal(topicId: string): TopicJournal {
    getAssistantTopic(topicId)
    let journal = this.journals.get(topicId)
    if (!journal) {
      if (this.journals.size >= 128) {
        const oldest = [...this.journals.values()]
          .filter((item) => item.disposable)
          .sort((a, b) => a.lastUsedAt - b.lastUsedAt)[0]
        if (!oldest) throw new RemoteRpcError('RESOURCE_EXHAUSTED', 'Too many retained topic journals')
        oldest.dispose()
        this.journals.delete(oldest.topicId)
      }
      journal = new TopicJournal(topicId, () => {
        this.enforceBudget()
        this.onAppend()
      })
      this.journals.set(topicId, journal)
    }
    journal.lastUsedAt = Date.now()
    journal.poll()
    return journal
  }
  activeExecutionIds(topicId: string): string[] {
    if (!application.get('AiStreamManager').hasLiveStream(topicId)) return []
    return this.journal(topicId).activeExecutionIds()
  }
  sweep(): void {
    for (const [id, journal] of this.journals) {
      try {
        if (journal.disposable && journal.lastUsedAt < Date.now() - remoteLimits.replayMs) {
          journal.dispose()
          this.journals.delete(id)
        } else journal.poll()
      } catch {
        journal.dispose()
        this.journals.delete(id)
      }
    }
  }
  private enforceBudget(maxBytes: number = remoteLimits.globalReplayBytes): void {
    let excess = [...this.journals.values()].reduce((bytes, journal) => bytes + journal.replayBytes, 0) - maxBytes
    for (const journal of this.journals.values()) {
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
