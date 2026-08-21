import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import {
  ConversationAttachStatus,
  ConversationExecutionAttachState,
  type ConversationExecutionId,
  type ConversationRef,
  conversationRefsEqual,
  ConversationStreamTerminalStatus,
  type ConversationTurnId
} from '@shared/ai/conversation'
import type {
  AiStreamAttachResponse,
  ConversationExecutionProjection,
  ExecutionAttachSnapshot,
  ExecutionAttachTerminal,
  StreamChunkPayload,
  StreamDonePayload,
  StreamErrorPayload
} from '@shared/ai/transport'
import type { CherryUIMessageChunk } from '@shared/data/types/message'
import type { SerializedError } from '@shared/types/error'
import type { UIMessageChunk } from 'ai'

import { streamAttachmentService } from './StreamAttachmentService'

const logger = loggerService.withContext('ConversationStreamSubscription')
const ATTACH_RETRY_DELAY_MS = 250

function assertNever(value: never): never {
  throw new Error(`Unhandled Conversation attachment variant: ${String(value)}`)
}

export interface ExecutionTerminal {
  turnId: ConversationTurnId
  executionId: ConversationExecutionId
  outputNodeId: string
  isAbort: boolean
  isError: boolean
}

type TerminalListener = (terminal: ExecutionTerminal) => void
type ConversationStateListener = () => void
type ConversationQuiescedListener = (turnId: ConversationTurnId) => void
type RefreshRequiredListener = (turnIds: readonly ConversationTurnId[]) => void

enum ConversationAttachmentPhase {
  Detached = 'detached',
  Attaching = 'attaching',
  Attached = 'attached',
  RetryWaiting = 'retry-waiting'
}

enum BufferedAttachmentEventType {
  Chunk = 'chunk',
  Done = 'done',
  Error = 'error'
}

type BufferedAttachmentEvent =
  | { readonly type: BufferedAttachmentEventType.Chunk; readonly payload: StreamChunkPayload }
  | { readonly type: BufferedAttachmentEventType.Done; readonly payload: StreamDonePayload }
  | { readonly type: BufferedAttachmentEventType.Error; readonly payload: StreamErrorPayload }

interface Branch {
  readonly projection: ConversationExecutionProjection
  stream: ReadableStream<UIMessageChunk>
  controller: ReadableStreamDefaultController<UIMessageChunk> | null
  lastChunkSeq: number
  closed: boolean
}

const createBranch = (projection: ConversationExecutionProjection): Branch => {
  const branch: Branch = {
    projection,
    stream: undefined as never,
    controller: null,
    lastChunkSeq: 0,
    closed: false
  }
  branch.stream = new ReadableStream<UIMessageChunk>({
    start(controller) {
      branch.controller = controller
    },
    cancel() {
      branch.closed = true
    }
  })
  return branch
}

/** Renderer data-plane observer. It owns no admission or lifecycle policy. */
export class ConversationStreamSubscription {
  readonly #branches = new Map<ConversationExecutionId, Branch>()
  readonly #terminals = new Map<ConversationExecutionId, ExecutionTerminal>()
  readonly #terminalListeners = new Set<TerminalListener>()
  readonly #stateListeners = new Set<ConversationStateListener>()
  readonly #quiescedListeners = new Set<ConversationQuiescedListener>()
  readonly #refreshRequiredListeners = new Set<RefreshRequiredListener>()
  #ipcUnsubs: Array<() => void> = []
  #attachmentPhase = ConversationAttachmentPhase.Detached
  #attachInFlight: Promise<void> | null = null
  #attachBuffer: BufferedAttachmentEvent[] | null = null
  #attachRetryTimer: number | null = null
  #releaseAttachment: (() => void) | null = null
  #attachmentGeneration = 0
  #disposed = false
  #conversationOpen = false
  #lastQuiescedTurnId: ConversationTurnId | undefined

  constructor(readonly conversation: ConversationRef) {}

  listen(): void {
    if (!this.#disposed) this.#setupIpcListeners()
  }

  register(projection: ConversationExecutionProjection): ReadableStream<UIMessageChunk> {
    const branch = this.#getOrCreateBranch(projection)
    this.#conversationOpen = true
    if (!branch.closed) void this.#ensureAttached()
    return branch.stream
  }

  hasOpenBranch(executionId: ConversationExecutionId): boolean {
    return this.#branches.get(executionId)?.closed === false
  }

  hasAnyOpenBranch(): boolean {
    return [...this.#branches.values()].some(({ closed }) => !closed)
  }

  isConversationOpen(): boolean {
    return this.#conversationOpen
  }

  isSettled(executionId: ConversationExecutionId): boolean {
    return this.#terminals.has(executionId)
  }

  unregister(executionId: ConversationExecutionId): void {
    const branch = this.#branches.get(executionId)
    if (branch) {
      this.#closeBranch(branch)
      this.#branches.delete(executionId)
    }
    this.#terminals.delete(executionId)
    if (this.#branches.size === 0) {
      this.#setConversationOpen(false)
      queueMicrotask(() => this.#detachIfIdle())
    }
  }

  cancelBranch(executionId: ConversationExecutionId): void {
    const branch = this.#branches.get(executionId)
    if (!branch) return
    branch.closed = true
    try {
      branch.controller?.error()
    } catch {
      // Reader already settled.
    }
  }

  onExecutionTerminal(listener: TerminalListener): () => void {
    this.#terminalListeners.add(listener)
    for (const terminal of this.#terminals.values()) listener(terminal)
    return () => this.#terminalListeners.delete(listener)
  }

  onConversationStateChange(listener: ConversationStateListener): () => void {
    this.#stateListeners.add(listener)
    return () => this.#stateListeners.delete(listener)
  }

  onConversationQuiesced(listener: ConversationQuiescedListener): () => void {
    this.#quiescedListeners.add(listener)
    if (this.#lastQuiescedTurnId) listener(this.#lastQuiescedTurnId)
    return () => this.#quiescedListeners.delete(listener)
  }

  onRefreshRequired(listener: RefreshRequiredListener): () => void {
    this.#refreshRequiredListeners.add(listener)
    return () => this.#refreshRequiredListeners.delete(listener)
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    for (const branch of this.#branches.values()) this.#closeBranch(branch)
    this.#branches.clear()
    this.#terminals.clear()
    this.#terminalListeners.clear()
    this.#stateListeners.clear()
    this.#quiescedListeners.clear()
    this.#refreshRequiredListeners.clear()
    this.#clearAttachRetry()
    this.#detach()
    for (const unsubscribe of this.#ipcUnsubs) unsubscribe()
    this.#ipcUnsubs = []
  }

  #getOrCreateBranch(projection: ConversationExecutionProjection): Branch {
    const existing = this.#branches.get(projection.executionId)
    if (existing) return existing
    const branch = createBranch(projection)
    if (this.#terminals.has(projection.executionId)) this.#closeBranch(branch)
    else this.#branches.set(projection.executionId, branch)
    return branch
  }

  #routeChunk(payload: StreamChunkPayload): void {
    if (!conversationRefsEqual(payload.conversation, this.conversation)) return
    if (this.#terminals.has(payload.executionId)) return
    this.#setConversationOpen(true)
    const projection: ConversationExecutionProjection = {
      turnId: payload.turnId,
      executionId: payload.executionId,
      modelId: payload.modelId,
      outputNodeId: payload.outputNodeId
    }
    const branch = this.#getOrCreateBranch(projection)
    const throughChunkSeq = payload.throughChunkSeq ?? payload.chunkSeq
    if (throughChunkSeq <= branch.lastChunkSeq) return
    branch.lastChunkSeq = throughChunkSeq
    branch.controller?.enqueue(payload.chunk)
  }

  #settle(terminal: ExecutionTerminal): void {
    if (this.#terminals.has(terminal.executionId)) return
    const branch = this.#branches.get(terminal.executionId)
    if (branch) this.#closeBranch(branch)
    this.#terminals.set(terminal.executionId, terminal)
    for (const listener of this.#terminalListeners) listener(terminal)
  }

  #enqueueError(error: SerializedError, executionId?: ConversationExecutionId): void {
    const chunk: CherryUIMessageChunk = { type: 'data-error', data: { ...error } }
    const branches = [...this.#branches.values()].filter(
      (branch) => executionId === undefined || branch.projection.executionId === executionId
    )
    for (const branch of branches) if (!branch.closed) branch.controller?.enqueue(chunk)
  }

  #closeBranch(branch: Branch): void {
    if (branch.closed) return
    branch.closed = true
    try {
      branch.controller?.close()
    } catch {
      // Reader already settled.
    }
  }

  #setConversationOpen(open: boolean): void {
    if (this.#conversationOpen === open) return
    this.#conversationOpen = open
    for (const listener of this.#stateListeners) listener()
  }

  #publishQuiescence(turnId: ConversationTurnId): void {
    this.#lastQuiescedTurnId = turnId
    for (const listener of this.#quiescedListeners) listener(turnId)
  }

  #setupIpcListeners(): void {
    if (this.#ipcUnsubs.length > 0) return
    this.#ipcUnsubs.push(
      ipcApi.on('ai.stream.chunk', (payload) =>
        this.#acceptAttachEvent({ type: BufferedAttachmentEventType.Chunk, payload })
      ),
      ipcApi.on('ai.stream.done', (payload) =>
        this.#acceptAttachEvent({ type: BufferedAttachmentEventType.Done, payload })
      ),
      ipcApi.on('ai.stream.error', (payload) =>
        this.#acceptAttachEvent({ type: BufferedAttachmentEventType.Error, payload })
      )
    )
  }

  #acceptAttachEvent(event: BufferedAttachmentEvent): void {
    if (!conversationRefsEqual(event.payload.conversation, this.conversation)) return
    if (this.#attachBuffer) {
      this.#attachBuffer.push(event)
      return
    }
    this.#applyAttachEvent(event)
  }

  #applyAttachEvent(event: BufferedAttachmentEvent): void {
    switch (event.type) {
      case BufferedAttachmentEventType.Chunk:
        this.#routeChunk(event.payload)
        return
      case BufferedAttachmentEventType.Done:
        this.#settle({
          turnId: event.payload.turnId,
          executionId: event.payload.executionId,
          outputNodeId: event.payload.outputNodeId,
          isAbort: event.payload.status === ConversationStreamTerminalStatus.Paused,
          isError: false
        })
        if (event.payload.turnTerminal) {
          this.#setConversationOpen(false)
          this.#publishQuiescence(event.payload.turnId)
        }
        return
      case BufferedAttachmentEventType.Error:
        this.#enqueueError(event.payload.error, event.payload.executionId)
        this.#settle({
          turnId: event.payload.turnId,
          executionId: event.payload.executionId,
          outputNodeId: event.payload.outputNodeId,
          isAbort: false,
          isError: true
        })
        if (event.payload.turnTerminal) {
          this.#setConversationOpen(false)
          this.#publishQuiescence(event.payload.turnId)
        }
        return
      default:
        return assertNever(event)
    }
  }

  #applyAttachSnapshot(result: AiStreamAttachResponse): void {
    const buffered = this.#attachBuffer ?? []
    this.#attachBuffer = null
    if (result.status === ConversationAttachStatus.NotFound) {
      this.#attachmentPhase = ConversationAttachmentPhase.Detached
      this.#releaseAttachmentLease()
      this.#setConversationOpen(false)
      this.#publishRefreshRequired([
        ...new Set([...this.#branches.values()].map(({ projection }) => projection.turnId))
      ])
      for (const event of buffered) this.#applyAttachEvent(event)
      return
    }

    this.#attachmentPhase = ConversationAttachmentPhase.Attached
    for (const snapshot of result.executions) this.#applyExecutionSnapshot(snapshot)
    this.#setConversationOpen(result.status === ConversationAttachStatus.Live)
    if (result.status === ConversationAttachStatus.Settled) this.#publishQuiescence(result.turnId)
    for (const event of buffered) this.#applyAttachEvent(event)
  }

  #applyExecutionSnapshot(snapshot: ExecutionAttachSnapshot): void {
    for (const payload of snapshot.replay.chunks) this.#routeChunk(payload)
    if (snapshot.replay.truncated) this.#publishRefreshRequired([snapshot.projection.turnId])
    switch (snapshot.state) {
      case ConversationExecutionAttachState.Live:
        return
      case ConversationExecutionAttachState.Settled:
        this.#settleFromSnapshot(snapshot.projection, snapshot.terminal)
        return
      default:
        return assertNever(snapshot)
    }
  }

  #settleFromSnapshot(projection: ConversationExecutionProjection, terminal: ExecutionAttachTerminal): void {
    if (terminal.status === ConversationStreamTerminalStatus.Error) {
      this.#enqueueError(terminal.error, projection.executionId)
    }
    this.#settle({
      turnId: projection.turnId,
      executionId: projection.executionId,
      outputNodeId: projection.outputNodeId ?? '',
      isAbort: terminal.status === ConversationStreamTerminalStatus.Paused,
      isError: terminal.status === ConversationStreamTerminalStatus.Error
    })
  }

  #publishRefreshRequired(turnIds: readonly ConversationTurnId[]): void {
    if (turnIds.length === 0) return
    for (const listener of this.#refreshRequiredListeners) listener(turnIds)
  }

  #scheduleAttachRetry(): void {
    if (this.#disposed || this.#attachRetryTimer !== null || this.#branches.size === 0) return
    this.#attachRetryTimer = window.setTimeout(() => {
      this.#attachRetryTimer = null
      if (!this.#disposed && this.#branches.size > 0) void this.#ensureAttached()
    }, ATTACH_RETRY_DELAY_MS)
  }

  #clearAttachRetry(): void {
    if (this.#attachRetryTimer !== null) window.clearTimeout(this.#attachRetryTimer)
    this.#attachRetryTimer = null
  }

  async #ensureAttached(): Promise<void> {
    if (this.#attachmentPhase === ConversationAttachmentPhase.Attached || this.#attachInFlight || this.#disposed) {
      return this.#attachInFlight ?? undefined
    }
    this.#setupIpcListeners()
    this.#clearAttachRetry()
    this.#releaseAttachment ??= streamAttachmentService.acquire(this.conversation)
    this.#attachmentPhase = ConversationAttachmentPhase.Attaching
    this.#attachBuffer = []
    const generation = ++this.#attachmentGeneration
    const attaching = (async () => {
      try {
        const result = await ipcApi.request('ai.stream.attach', { conversation: this.conversation })
        if (this.#disposed || generation !== this.#attachmentGeneration) return
        this.#applyAttachSnapshot(result)
      } catch (error) {
        if (generation !== this.#attachmentGeneration) return
        logger.error('Conversation stream attach failed', { conversation: this.conversation, error })
        this.#attachmentPhase = ConversationAttachmentPhase.RetryWaiting
        const buffered = this.#attachBuffer ?? []
        this.#attachBuffer = null
        this.#releaseAttachmentLease()
        for (const event of buffered) this.#applyAttachEvent(event)
        this.#scheduleAttachRetry()
      } finally {
        if (generation === this.#attachmentGeneration) this.#attachInFlight = null
        this.#detachIfIdle()
      }
    })()
    this.#attachInFlight = attaching
    return this.#attachInFlight
  }

  #detachIfIdle(): void {
    if (this.#branches.size === 0 && !this.#conversationOpen) this.#detach()
  }

  #detach(): void {
    this.#attachmentGeneration += 1
    this.#attachmentPhase = ConversationAttachmentPhase.Detached
    this.#attachInFlight = null
    this.#attachBuffer = null
    this.#clearAttachRetry()
    this.#releaseAttachmentLease()
  }

  #releaseAttachmentLease(): void {
    this.#releaseAttachment?.()
    this.#releaseAttachment = null
  }
}
