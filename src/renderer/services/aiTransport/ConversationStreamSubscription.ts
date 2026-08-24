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
import {
  type AiStreamAttachResponse,
  type ConversationExecutionProjection,
  ConversationReplayWindowKind,
  type ExecutionAttachSnapshot,
  type ExecutionAttachTerminal,
  type ReplayWindow,
  type StreamChunkPayload,
  type StreamDonePayload,
  type StreamErrorPayload
} from '@shared/ai/transport'
import type { CherryUIMessageChunk } from '@shared/data/types/message'
import type { SerializedError } from '@shared/types/error'
import type { UIMessageChunk } from 'ai'

import { streamAttachmentService } from './StreamAttachmentService'

const logger = loggerService.withContext('ConversationStreamSubscription')
const ATTACH_RETRY_DELAY_MS = 250
const MAX_ATTACH_ATTEMPTS = 4
const MAX_BUFFERED_EVENTS = 10_000

function assertNever(value: never): never {
  throw new Error(`Unhandled Conversation attachment variant: ${String(value)}`)
}

export interface ExecutionTerminal {
  turnId: ConversationTurnId
  executionId: ConversationExecutionId
  outputNodeId: string
  isAbort: boolean
  isError: boolean
  error?: SerializedError
}

type TerminalListener = (terminal: ExecutionTerminal) => void
type ConversationStateListener = () => void
type ConversationQuiescedListener = (turnId: ConversationTurnId) => void

export enum ConversationStreamRecoveryReason {
  Rebase = 'rebase',
  NotFound = 'not-found',
  AttachUnavailable = 'attach-unavailable'
}

export enum ConversationStreamRecoveryDisposition {
  Rebased = 'rebased',
  Retired = 'retired',
  RetryAttach = 'retry-attach'
}

export interface ConversationStreamRecoveryRequest {
  readonly recoveryId: string
  readonly attachmentGeneration: number
  readonly conversation: ConversationRef
  readonly turnId: ConversationTurnId
  readonly executionId: ConversationExecutionId
  readonly reason: ConversationStreamRecoveryReason
  readonly projection: ConversationExecutionProjection
  readonly replay?: Extract<ReplayWindow, { kind: ConversationReplayWindowKind.Rebase }>
}

export interface ConversationStreamRecoveryResult {
  readonly recoveryId: string
  readonly attachmentGeneration: number
  readonly turnId: ConversationTurnId
  readonly executionId: ConversationExecutionId
  readonly disposition: ConversationStreamRecoveryDisposition
}

export enum ConversationStreamRecoveryCompletion {
  Applied = 'applied',
  Stale = 'stale'
}

export type ConversationStreamRecoveryCompletionResult =
  | {
      readonly status: ConversationStreamRecoveryCompletion.Applied
      readonly branch: ReadableStream<UIMessageChunk> | null
    }
  | {
      readonly status: ConversationStreamRecoveryCompletion.Stale
    }

type RecoveryRequiredListener = (request: ConversationStreamRecoveryRequest) => void

enum ConversationAttachmentPhase {
  Detached = 'detached',
  Attaching = 'attaching',
  Attached = 'attached',
  RetryWaiting = 'retry-waiting',
  Recovering = 'recovering'
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

type AttachmentSession =
  | {
      readonly phase: ConversationAttachmentPhase.Detached
      readonly generation: number
      readonly attempts: number
    }
  | {
      readonly phase: ConversationAttachmentPhase.Attaching
      readonly generation: number
      readonly attempts: number
      readonly events: BufferedAttachmentEvent[]
    }
  | {
      readonly phase: ConversationAttachmentPhase.Attached
      readonly generation: number
      readonly attempts: number
    }
  | {
      readonly phase: ConversationAttachmentPhase.RetryWaiting
      readonly generation: number
      readonly attempts: number
    }
  | {
      readonly phase: ConversationAttachmentPhase.Recovering
      readonly generation: number
      readonly attempts: number
    }

interface Branch {
  readonly projection: ConversationExecutionProjection
  stream: ReadableStream<UIMessageChunk>
  controller: ReadableStreamDefaultController<UIMessageChunk> | null
  continuousThroughChunkSeq: number
  readonly pendingChunks: Map<number, StreamChunkPayload>
  droppedThroughChunkSeq: number
  recovery: ConversationStreamRecoveryRequest | null
  closed: boolean
}

const createBranch = (projection: ConversationExecutionProjection): Branch => {
  const branch: Branch = {
    projection,
    stream: undefined as never,
    controller: null,
    continuousThroughChunkSeq: 0,
    pendingChunks: new Map(),
    droppedThroughChunkSeq: 0,
    recovery: null,
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

/** Renderer data-plane observer. It owns attach generations and continuous replay cursors only. */
export class ConversationStreamSubscription {
  readonly #branches = new Map<ConversationExecutionId, Branch>()
  readonly #terminals = new Map<ConversationExecutionId, ExecutionTerminal>()
  readonly #terminalListeners = new Set<TerminalListener>()
  readonly #stateListeners = new Set<ConversationStateListener>()
  readonly #quiescedListeners = new Set<ConversationQuiescedListener>()
  readonly #recoveryRequiredListeners = new Set<RecoveryRequiredListener>()
  readonly #unclaimedEvents: BufferedAttachmentEvent[] = []
  #ipcUnsubs: Array<() => void> = []
  #session: AttachmentSession = {
    phase: ConversationAttachmentPhase.Detached,
    generation: 0,
    attempts: 0
  }
  #attachInFlight: Promise<void> | null = null
  #attachRetryTimer: number | null = null
  #releaseAttachment: (() => void) | null = null
  #nextRecoveryId = 0
  #disposed = false
  #conversationOpen = false
  #lastQuiescedTurnId: ConversationTurnId | undefined

  constructor(readonly conversation: ConversationRef) {}

  listen(): void {
    if (!this.#disposed) this.#setupIpcListeners()
  }

  register(projection: ConversationExecutionProjection): ReadableStream<UIMessageChunk> {
    const branch = this.#getOrCreateBranch(projection)
    if (!branch.closed && !branch.recovery) void this.#ensureAttached()
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

  unregister(executionId: ConversationExecutionId, expectedStream?: ReadableStream<UIMessageChunk>): void {
    const branch = this.#branches.get(executionId)
    if (!branch || (expectedStream && branch.stream !== expectedStream)) return
    branch.recovery = null
    this.#closeBranch(branch)
    this.#branches.delete(executionId)
    if (this.#branches.size === 0) queueMicrotask(() => this.#detachIfIdle())
  }

  retireExecution(executionId: ConversationExecutionId): void {
    this.unregister(executionId)
    this.#terminals.delete(executionId)
  }

  cancelBranch(executionId: ConversationExecutionId, expectedStream?: ReadableStream<UIMessageChunk>): void {
    const branch = this.#branches.get(executionId)
    if (!branch || (expectedStream && branch.stream !== expectedStream)) return
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

  onRecoveryRequired(listener: RecoveryRequiredListener): () => void {
    this.#recoveryRequiredListeners.add(listener)
    return () => this.#recoveryRequiredListeners.delete(listener)
  }

  completeRecovery(result: ConversationStreamRecoveryResult): ConversationStreamRecoveryCompletionResult {
    const branch = this.#branches.get(result.executionId)
    const recovery = branch?.recovery
    if (
      !branch ||
      !recovery ||
      recovery.recoveryId !== result.recoveryId ||
      recovery.attachmentGeneration !== result.attachmentGeneration ||
      recovery.turnId !== result.turnId ||
      branch.projection.turnId !== result.turnId ||
      this.#terminals.has(result.executionId)
    ) {
      return { status: ConversationStreamRecoveryCompletion.Stale }
    }

    switch (result.disposition) {
      case ConversationStreamRecoveryDisposition.Rebased: {
        const recovered = this.#completeRebase(branch, recovery)
        return recovered
          ? { status: ConversationStreamRecoveryCompletion.Applied, branch: recovered }
          : { status: ConversationStreamRecoveryCompletion.Stale }
      }
      case ConversationStreamRecoveryDisposition.Retired:
        this.retireExecution(result.executionId)
        this.#finishRecoverySession()
        return { status: ConversationStreamRecoveryCompletion.Applied, branch: null }
      case ConversationStreamRecoveryDisposition.RetryAttach:
        branch.recovery = null
        this.#session = {
          phase: ConversationAttachmentPhase.Detached,
          generation: this.#session.generation,
          attempts: 0
        }
        void this.#ensureAttached()
        return { status: ConversationStreamRecoveryCompletion.Applied, branch: branch.stream }
      default:
        return assertNever(result.disposition)
    }
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
    this.#recoveryRequiredListeners.clear()
    this.#unclaimedEvents.length = 0
    this.#clearAttachRetry()
    this.#detach()
    for (const unsubscribe of this.#ipcUnsubs) unsubscribe()
    this.#ipcUnsubs = []
  }

  #getOrCreateBranch(projection: ConversationExecutionProjection): Branch {
    const existing = this.#branches.get(projection.executionId)
    if (existing) return existing
    const branch = createBranch(projection)
    const terminal = this.#terminals.get(projection.executionId)
    if (terminal) {
      if (terminal.error) branch.controller?.enqueue({ type: 'data-error', data: { ...terminal.error } })
      this.#closeBranch(branch)
    } else {
      this.#branches.set(projection.executionId, branch)
      const claimed = this.#unclaimedEvents.filter(({ payload }) => payload.executionId === projection.executionId)
      if (claimed.length > 0) {
        for (let index = this.#unclaimedEvents.length - 1; index >= 0; index -= 1) {
          if (this.#unclaimedEvents[index]?.payload.executionId === projection.executionId) {
            this.#unclaimedEvents.splice(index, 1)
          }
        }
        for (const event of claimed) this.#applyAttachEvent(event)
      }
    }
    return branch
  }

  #routeChunk(payload: StreamChunkPayload): void {
    if (!conversationRefsEqual(payload.conversation, this.conversation) || this.#terminals.has(payload.executionId))
      return
    const branch = this.#branches.get(payload.executionId)
    if (!branch) {
      this.#bufferUnclaimed({ type: BufferedAttachmentEventType.Chunk, payload })
      return
    }
    this.#setConversationOpen(true)
    if (branch.recovery) {
      this.#bufferPendingChunk(branch, payload)
      return
    }
    const throughChunkSeq = payload.throughChunkSeq ?? payload.chunkSeq
    if (throughChunkSeq <= branch.continuousThroughChunkSeq) return
    if (payload.chunkSeq > branch.continuousThroughChunkSeq + 1) {
      this.#bufferPendingChunk(branch, payload)
      this.#reattachForReplayGap()
      return
    }
    branch.controller?.enqueue(payload.chunk)
    branch.continuousThroughChunkSeq = throughChunkSeq
    this.#drainPendingChunks(branch)
  }

  #bufferPendingChunk(branch: Branch, payload: StreamChunkPayload): void {
    branch.pendingChunks.set(payload.chunkSeq, payload)
    while (branch.pendingChunks.size > MAX_BUFFERED_EVENTS) {
      const oldest = branch.pendingChunks.keys().next().value
      if (oldest === undefined) break
      const dropped = branch.pendingChunks.get(oldest)
      branch.pendingChunks.delete(oldest)
      branch.droppedThroughChunkSeq = Math.max(
        branch.droppedThroughChunkSeq,
        dropped?.throughChunkSeq ?? dropped?.chunkSeq ?? oldest
      )
    }
  }

  #drainPendingChunks(branch: Branch): void {
    for (const sequence of [...branch.pendingChunks.keys()]) {
      if (sequence <= branch.continuousThroughChunkSeq) branch.pendingChunks.delete(sequence)
    }
    while (true) {
      const payload = branch.pendingChunks.get(branch.continuousThroughChunkSeq + 1)
      if (!payload) return
      branch.pendingChunks.delete(payload.chunkSeq)
      branch.controller?.enqueue(payload.chunk)
      branch.continuousThroughChunkSeq = payload.throughChunkSeq ?? payload.chunkSeq
    }
  }

  #reattachForReplayGap(): void {
    if (
      this.#session.phase === ConversationAttachmentPhase.Attached ||
      this.#session.phase === ConversationAttachmentPhase.Recovering
    ) {
      this.#session = {
        phase: ConversationAttachmentPhase.Detached,
        generation: this.#session.generation,
        attempts: this.#session.attempts
      }
    }
    void this.#ensureAttached()
  }

  #settle(terminal: ExecutionTerminal): void {
    if (this.#terminals.has(terminal.executionId)) return
    const branch = this.#branches.get(terminal.executionId)
    if (branch) {
      branch.recovery = null
      branch.pendingChunks.clear()
      this.#closeBranch(branch)
    }
    this.#terminals.set(terminal.executionId, terminal)
    this.#finishRecoverySession()
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
    if (this.#session.phase === ConversationAttachmentPhase.Attaching) {
      const events = this.#session.events
      if (event.type !== BufferedAttachmentEventType.Chunk || events.length < MAX_BUFFERED_EVENTS) {
        events.push(event)
      } else {
        const oldestChunk = events.findIndex(({ type }) => type === BufferedAttachmentEventType.Chunk)
        if (oldestChunk >= 0) events.splice(oldestChunk, 1)
        events.push(event)
      }
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
        if (!this.#branches.has(event.payload.executionId)) {
          this.#bufferUnclaimed(event)
          return
        }
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
          queueMicrotask(() => this.#detachIfIdle())
        }
        return
      case BufferedAttachmentEventType.Error:
        if (!this.#branches.has(event.payload.executionId)) {
          this.#bufferUnclaimed(event)
          return
        }
        this.#enqueueError(event.payload.error, event.payload.executionId)
        this.#settle({
          turnId: event.payload.turnId,
          executionId: event.payload.executionId,
          outputNodeId: event.payload.outputNodeId,
          isAbort: false,
          isError: true,
          error: event.payload.error
        })
        if (event.payload.turnTerminal) {
          this.#setConversationOpen(false)
          this.#publishQuiescence(event.payload.turnId)
          queueMicrotask(() => this.#detachIfIdle())
        }
        return
      default:
        return assertNever(event)
    }
  }

  #applyAttachSnapshot(result: AiStreamAttachResponse, generation: number, buffered: BufferedAttachmentEvent[]): void {
    if (result.status === ConversationAttachStatus.NotFound) {
      this.#session = { phase: ConversationAttachmentPhase.Recovering, generation, attempts: 0 }
      this.#releaseAttachmentLease()
      this.#setConversationOpen(false)
      for (const branch of this.#branches.values()) {
        this.#requestRecovery(branch, ConversationStreamRecoveryReason.NotFound, generation)
      }
      for (const event of buffered) this.#applyAttachEvent(event)
      return
    }

    this.#session = { phase: ConversationAttachmentPhase.Attached, generation, attempts: 0 }
    for (const snapshot of result.executions) this.#applyExecutionSnapshot(snapshot, generation)
    this.#setConversationOpen(result.status === ConversationAttachStatus.Live)
    if (result.status === ConversationAttachStatus.Settled) this.#publishQuiescence(result.turnId)
    for (const event of buffered) this.#applyAttachEvent(event)
  }

  #bufferUnclaimed(event: BufferedAttachmentEvent): void {
    this.#unclaimedEvents.push(event)
    while (this.#unclaimedEvents.length > MAX_BUFFERED_EVENTS) this.#unclaimedEvents.shift()
  }

  #applyExecutionSnapshot(snapshot: ExecutionAttachSnapshot, generation: number): void {
    switch (snapshot.replay.kind) {
      case ConversationReplayWindowKind.Continuous:
        this.#applyContinuousReplay(snapshot)
        break
      case ConversationReplayWindowKind.Rebase: {
        const branch = this.#getOrCreateBranch(snapshot.projection)
        this.#requestRecovery(branch, ConversationStreamRecoveryReason.Rebase, generation, snapshot.replay)
        break
      }
      default:
        assertNever(snapshot.replay)
    }
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

  #applyContinuousReplay(snapshot: ExecutionAttachSnapshot): void {
    if (this.#terminals.has(snapshot.projection.executionId)) return
    const branch = this.#getOrCreateBranch(snapshot.projection)
    const baseline = branch.continuousThroughChunkSeq
    let coveredChunkSeq = baseline
    for (const payload of snapshot.replay.chunks) {
      if (!conversationRefsEqual(payload.conversation, this.conversation)) continue
      if (payload.executionId !== snapshot.projection.executionId) continue
      const throughChunkSeq = payload.throughChunkSeq ?? payload.chunkSeq
      if (throughChunkSeq <= baseline) continue
      if (payload.chunkSeq <= baseline || payload.chunkSeq > coveredChunkSeq + 1) {
        this.#bufferPendingChunk(branch, payload)
        this.#reattachForReplayGap()
        return
      }
      branch.controller?.enqueue(payload.chunk)
      coveredChunkSeq = Math.max(coveredChunkSeq, throughChunkSeq)
    }
    if (coveredChunkSeq < snapshot.replay.throughChunkSeq) {
      this.#reattachForReplayGap()
      return
    }
    branch.continuousThroughChunkSeq = coveredChunkSeq
    branch.droppedThroughChunkSeq = 0
    this.#drainPendingChunks(branch)
  }

  #settleFromSnapshot(projection: ConversationExecutionProjection, terminal: ExecutionAttachTerminal): void {
    if (terminal.status === ConversationStreamTerminalStatus.Error)
      this.#enqueueError(terminal.error, projection.executionId)
    this.#settle({
      turnId: projection.turnId,
      executionId: projection.executionId,
      outputNodeId: projection.outputNodeId ?? '',
      isAbort: terminal.status === ConversationStreamTerminalStatus.Paused,
      isError: terminal.status === ConversationStreamTerminalStatus.Error,
      error: terminal.status === ConversationStreamTerminalStatus.Error ? terminal.error : undefined
    })
  }

  #requestRecovery(
    branch: Branch,
    reason: ConversationStreamRecoveryReason,
    generation: number,
    replay?: Extract<ReplayWindow, { kind: ConversationReplayWindowKind.Rebase }>
  ): void {
    if (branch.recovery || this.#terminals.has(branch.projection.executionId)) return
    const request: ConversationStreamRecoveryRequest = {
      recoveryId: `${generation}:${++this.#nextRecoveryId}`,
      attachmentGeneration: generation,
      conversation: this.conversation,
      turnId: branch.projection.turnId,
      executionId: branch.projection.executionId,
      reason,
      projection: branch.projection,
      replay
    }
    branch.recovery = request
    this.#session = {
      phase: ConversationAttachmentPhase.Recovering,
      generation,
      attempts: this.#session.attempts
    }
    for (const listener of this.#recoveryRequiredListeners) listener(request)
  }

  #completeRebase(
    previous: Branch,
    recovery: ConversationStreamRecoveryRequest
  ): ReadableStream<UIMessageChunk> | null {
    const replay = recovery.replay
    if (!replay) return null
    const pending = new Map(previous.pendingChunks)
    this.#closeBranch(previous)
    const branch = createBranch(recovery.projection)
    this.#branches.set(recovery.executionId, branch)
    for (const payload of replay.chunks) branch.controller?.enqueue(payload.chunk)
    branch.continuousThroughChunkSeq = replay.throughChunkSeq
    for (const [sequence, payload] of pending) {
      if (sequence > branch.continuousThroughChunkSeq) branch.pendingChunks.set(sequence, payload)
    }
    branch.droppedThroughChunkSeq =
      previous.droppedThroughChunkSeq > replay.throughChunkSeq ? previous.droppedThroughChunkSeq : 0
    this.#drainPendingChunks(branch)
    const hasGap =
      branch.droppedThroughChunkSeq > branch.continuousThroughChunkSeq ||
      ([...branch.pendingChunks.keys()].sort((left, right) => left - right)[0] ??
        branch.continuousThroughChunkSeq + 1) >
        branch.continuousThroughChunkSeq + 1
    this.#finishRecoverySession()
    if (hasGap) {
      this.#session = {
        phase: ConversationAttachmentPhase.Detached,
        generation: this.#session.generation,
        attempts: 0
      }
      queueMicrotask(() => void this.#ensureAttached())
    }
    return branch.stream
  }

  #finishRecoverySession(): void {
    if ([...this.#branches.values()].some(({ recovery }) => recovery !== null)) return
    if (this.#session.phase === ConversationAttachmentPhase.Recovering) {
      this.#session = {
        phase: this.#releaseAttachment ? ConversationAttachmentPhase.Attached : ConversationAttachmentPhase.Detached,
        generation: this.#session.generation,
        attempts: 0
      }
      if (!this.#releaseAttachment && this.hasAnyOpenBranch()) queueMicrotask(() => void this.#ensureAttached())
    }
  }

  #scheduleAttachRetry(): void {
    if (
      this.#disposed ||
      this.#attachRetryTimer !== null ||
      this.#branches.size === 0 ||
      this.#session.attempts >= MAX_ATTACH_ATTEMPTS
    ) {
      return
    }
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
    if (
      this.#session.phase === ConversationAttachmentPhase.Attached ||
      this.#session.phase === ConversationAttachmentPhase.Recovering ||
      this.#attachInFlight ||
      this.#disposed
    ) {
      return this.#attachInFlight ?? undefined
    }
    this.#setupIpcListeners()
    this.#clearAttachRetry()
    this.#releaseAttachment ??= streamAttachmentService.acquire(this.conversation)
    const generation = this.#session.generation + 1
    const attempts = this.#session.attempts + 1
    const events: BufferedAttachmentEvent[] = []
    this.#session = { phase: ConversationAttachmentPhase.Attaching, generation, attempts, events }
    const attaching = (async () => {
      try {
        const result = await ipcApi.request('ai.stream.attach', {
          conversation: this.conversation,
          cursors: [...this.#branches.values()].map(({ projection, continuousThroughChunkSeq }) => ({
            turnId: projection.turnId,
            executionId: projection.executionId,
            throughChunkSeq: continuousThroughChunkSeq
          }))
        })
        if (this.#disposed || this.#session.generation !== generation) return
        this.#applyAttachSnapshot(result, generation, events)
      } catch (error) {
        if (this.#session.generation !== generation) return
        logger.error('Conversation stream attach failed', { conversation: this.conversation, error })
        this.#releaseAttachmentLease()
        for (const event of events) this.#applyAttachEvent(event)
        if (attempts >= MAX_ATTACH_ATTEMPTS) {
          this.#session = { phase: ConversationAttachmentPhase.Recovering, generation, attempts }
          for (const branch of this.#branches.values()) {
            this.#requestRecovery(branch, ConversationStreamRecoveryReason.AttachUnavailable, generation)
          }
        } else {
          this.#session = { phase: ConversationAttachmentPhase.RetryWaiting, generation, attempts }
          this.#scheduleAttachRetry()
        }
      } finally {
        if (this.#session.generation === generation) this.#attachInFlight = null
        this.#detachIfIdle()
      }
    })()
    this.#attachInFlight = attaching
    return attaching
  }

  #detachIfIdle(): void {
    if (this.#branches.size === 0 && !this.#conversationOpen) this.#detach()
  }

  #detach(): void {
    const generation = this.#session.generation + 1
    for (const branch of this.#branches.values()) branch.recovery = null
    this.#session = { phase: ConversationAttachmentPhase.Detached, generation, attempts: 0 }
    this.#attachInFlight = null
    this.#clearAttachRetry()
    this.#releaseAttachmentLease()
  }

  #releaseAttachmentLease(): void {
    this.#releaseAttachment?.()
    this.#releaseAttachment = null
  }
}
