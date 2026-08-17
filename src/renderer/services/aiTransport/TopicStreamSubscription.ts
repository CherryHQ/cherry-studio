import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { type AttemptId, toAttemptId } from '@shared/ai/attempt'
import type {
  StreamAttachSnapshot,
  StreamChunkPayload,
  StreamProtocolEvent,
  StreamProtocolReplayChunkEvent
} from '@shared/ai/transport'
import type { CherryUIMessageChunk } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import type { SerializedError } from '@shared/types/error'
import type { UIMessageChunk } from 'ai'

import { TopicStreamProjection } from './TopicAttemptProjection'

const logger = loggerService.withContext('TopicStreamSubscription')

export interface ExecutionTerminal {
  attemptId?: AttemptId
  anchorMessageId?: string
  isAbort: boolean
  isError: boolean
}

type TerminalListener = (executionId: UniqueModelId, terminal: ExecutionTerminal) => void
type TopicStateListener = () => void
export interface TopicQuiescedProjectionEvent {
  cycleId?: number
  throughAttemptId: number
}

type TopicQuiescedListener = (event: TopicQuiescedProjectionEvent) => void

interface RetiredExecutionBranch {
  executionId: UniqueModelId
  attemptId: AttemptId
  anchorMessageId?: string
}

type BranchRetirementListener = (branches: readonly RetiredExecutionBranch[]) => void

interface Branch {
  executionId: UniqueModelId
  attemptId: AttemptId
  anchorMessageId?: string
  /** Cycle adopted from protocol evidence (this attempt's own event or an attach
   *  snapshot); undefined = unclassified, exempt from cross-cycle retirement. */
  cycleId?: number
  stream: ReadableStream<UIMessageChunk>
  controller: ReadableStreamDefaultController<UIMessageChunk> | null
  closed: boolean
}

function createBranch(
  executionId: UniqueModelId,
  anchorMessageId: string | undefined,
  attemptId: AttemptId,
  cycleId: number | undefined
): Branch {
  const branch: Branch = {
    executionId,
    attemptId,
    anchorMessageId,
    cycleId,
    stream: undefined as never,
    controller: null,
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

export class TopicStreamSubscription {
  readonly #topicId: string
  readonly #projection: TopicStreamProjection
  readonly #branches = new Map<AttemptId, Branch>()
  readonly #terminalByAttemptId = new Map<AttemptId, { executionId: UniqueModelId; terminal: ExecutionTerminal }>()
  readonly #terminalListeners = new Set<TerminalListener>()
  readonly #branchRetirementListeners = new Set<BranchRetirementListener>()
  readonly #topicStateListeners = new Set<TopicStateListener>()
  readonly #topicQuiescedListeners = new Set<TopicQuiescedListener>()
  #ipcUnsubs: Array<() => void> = []
  #attached = false
  #attachInFlight: Promise<void> | null = null
  #disposed = false
  #topicOpen = false
  #lastQuiesced: TopicQuiescedProjectionEvent | undefined
  #protocol: 'pending' | 'v2' | 'legacy' = 'pending'
  #cycleId: number | undefined
  #controlRevision = 0
  readonly #lastChunkSeq = new Map<AttemptId, number>()
  readonly #pendingProtocolEvents: StreamProtocolEvent[] = []
  readonly #pendingLegacyEvents: Array<() => void> = []

  constructor(topicId: string) {
    this.#topicId = topicId
    this.#projection = new TopicStreamProjection(topicId)
  }

  listen(): void {
    if (this.#disposed) return
    this.#setupIpcListeners()
  }

  register(
    executionId: UniqueModelId,
    anchorMessageId: string | undefined,
    attemptId: number
  ): ReadableStream<UIMessageChunk> {
    // The branch controller is created synchronously inside `createBranch`,
    // so chunks arriving before this call are already queued — late readers
    // never lose replay/early chunks.
    // Registrations (open ACK / SharedCache projection) carry no cycle identity —
    // the current #cycleId may already be stale, so the branch starts unclassified.
    const branch = this.#getOrCreateBranch(executionId, anchorMessageId, attemptId, undefined)
    if (!branch.closed) void this.#ensureAttached()
    return branch.stream
  }

  /** True when the branch for this exact key exists and is still open —
   *  i.e. a stream (typically a new turn's auto-created branch) has produced
   *  chunks that no reader has claimed yet. */
  hasOpenBranch(executionId: UniqueModelId, anchorMessageId: string | undefined, attemptId: number): boolean {
    const branch = this.#branches.get(toAttemptId(attemptId))
    return branch?.executionId === executionId && branch.anchorMessageId === anchorMessageId && !branch.closed
  }

  /** True when any open branch remains — e.g. a continuation round's chunks
   *  arrived after the previous round's reader retired and are queuing,
   *  unclaimed, for the next mounted reader. */
  hasAnyOpenBranch(): boolean {
    for (const branch of this.#branches.values()) {
      if (!branch.closed) return true
    }
    return false
  }

  /** Main has explicitly ended an execution with `isTopicDone=false`, so
   *  another execution may follow even when no branch exists yet. */
  isTopicOpen(): boolean {
    return this.#topicOpen
  }

  isSettled(attemptId: number): boolean {
    return this.#projection.isSettled(attemptId)
  }

  unregister(executionId: UniqueModelId, anchorMessageId: string | undefined, attemptId: number): void {
    const id = toAttemptId(attemptId)
    const branch = this.#branches.get(id)
    if (branch?.executionId === executionId && branch.anchorMessageId === anchorMessageId) {
      this.#closeBranch(branch)
      this.#branches.delete(id)
    }
    this.#terminalByAttemptId.delete(id)
    if (this.#branches.size === 0 && this.#attached && !this.#disposed && !this.#topicOpen) {
      // Defer one tick: a transient `activeExecutions` flicker would otherwise
      // detach→reattach and momentarily drop Main's last listener.
      queueMicrotask(() => {
        if (this.#branches.size === 0 && this.#attached && !this.#disposed && !this.#topicOpen) this.#detach()
      })
    }
  }

  cancelBranch(executionId: UniqueModelId, anchorMessageId: string | undefined, attemptId: number): void {
    const branch = this.#branches.get(toAttemptId(attemptId))
    if (!branch || branch.executionId !== executionId || branch.anchorMessageId !== anchorMessageId || branch.closed)
      return
    branch.closed = true
    try {
      branch.controller?.error()
    } catch {
      // already closed/errored — fine
    }
  }

  onExecutionTerminal(listener: TerminalListener): () => void {
    this.#terminalListeners.add(listener)
    for (const { executionId, terminal } of this.#terminalByAttemptId.values()) {
      try {
        listener(executionId, terminal)
      } catch (err) {
        logger.warn('terminal listener threw during replay', { topicId: this.#topicId, err })
      }
    }
    return () => this.#terminalListeners.delete(listener)
  }

  onBranchesRetired(listener: BranchRetirementListener): () => void {
    this.#branchRetirementListeners.add(listener)
    return () => this.#branchRetirementListeners.delete(listener)
  }

  onTopicStateChange(listener: TopicStateListener): () => void {
    this.#topicStateListeners.add(listener)
    return () => this.#topicStateListeners.delete(listener)
  }

  onTopicQuiesced(listener: TopicQuiescedListener): () => void {
    this.#topicQuiescedListeners.add(listener)
    if (this.#lastQuiesced) {
      try {
        listener(this.#lastQuiesced)
      } catch (err) {
        logger.warn('topic quiesced listener threw during replay', { topicId: this.#topicId, err })
      }
    }
    return () => this.#topicQuiescedListeners.delete(listener)
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    for (const branch of this.#branches.values()) this.#closeBranch(branch)
    this.#branches.clear()
    this.#terminalByAttemptId.clear()
    this.#terminalListeners.clear()
    this.#branchRetirementListeners.clear()
    this.#topicStateListeners.clear()
    this.#topicQuiescedListeners.clear()
    this.#pendingProtocolEvents.length = 0
    this.#pendingLegacyEvents.length = 0
    if (this.#attached) void ipcApi.request('ai.stream.detach', { topicId: this.#topicId }).catch(() => {})
    this.#attached = false
    this.#attachInFlight = null
    for (const unsub of this.#ipcUnsubs) unsub()
    this.#ipcUnsubs = []
  }

  // ── internals ──────────────────────────────────────────────────────

  #getOrCreateBranch(
    executionId: UniqueModelId,
    anchorMessageId: string | undefined,
    attemptId: number,
    cycleId: number | undefined
  ): Branch {
    const id = toAttemptId(attemptId)
    let branch = this.#branches.get(id)
    if (!branch) {
      const registration = this.#projection.register({ executionId, anchorMessageId, attemptId })
      if (registration.replaced) {
        const replacedBranch = this.#branches.get(registration.replaced.descriptor.attemptId)
        if (replacedBranch) this.#retireBranches([replacedBranch])
        if (registration.replacedUnsettled) {
          logger.error('newer attempt replaced an unsettled renderer slot', {
            topicId: this.#topicId,
            attemptId,
            replacedAttemptId: registration.replaced.descriptor.attemptId
          })
        }
      }
      branch = createBranch(executionId, anchorMessageId, id, cycleId)
      if (!registration.accepted || this.#isBranchSettled(id)) {
        this.#closeBranch(branch)
        return branch
      }
      this.#branches.set(id, branch)
    } else if (branch.cycleId === undefined && cycleId !== undefined) {
      // An unclassified registration adopts the cycle of its own first event.
      branch.cycleId = cycleId
    }
    return branch
  }

  #terminalFor(attemptId: AttemptId): ExecutionTerminal | undefined {
    return this.#terminalByAttemptId.get(attemptId)?.terminal
  }

  #isBranchSettled(attemptId: AttemptId): boolean {
    return this.#terminalFor(attemptId) !== undefined || this.#projection.isSettled(attemptId)
  }

  #closeBranch(branch: Branch): void {
    if (branch.closed) return
    branch.closed = true
    try {
      branch.controller?.close()
    } catch {
      // already closed/errored — fine
    }
  }

  #routeChunk(payload: StreamChunkPayload): void {
    if (payload.topicId !== this.#topicId) return
    const { executionId, attemptId } = payload
    if (!executionId || attemptId === undefined) {
      logger.warn('chunk without execution identity dropped', {
        topicId: this.#topicId,
        hasExecutionId: executionId !== undefined,
        hasAttemptId: attemptId !== undefined
      })
      return
    }
    if (this.#isBranchSettled(toAttemptId(attemptId))) return
    // #cycleId is already synced to this event's cycle (undefined on legacy),
    // so it is authoritative evidence for the branch.
    const branch = this.#getOrCreateBranch(executionId, payload.anchorMessageId, attemptId, this.#cycleId)
    if (!branch.closed) branch.controller?.enqueue(payload.chunk)
  }

  /** Mirror PersistenceListener's stored error part into the live branch before it closes. */
  #enqueueError(
    error: SerializedError,
    executionId?: UniqueModelId,
    anchorMessageId?: string,
    attemptId?: number,
    topicAttemptWatermark?: number
  ): void {
    const chunk: CherryUIMessageChunk = { type: 'data-error', data: { ...error } }

    if (executionId && attemptId !== undefined) {
      const branch = this.#getOrCreateBranch(executionId, anchorMessageId, attemptId, this.#cycleId)
      if (!branch.closed) branch.controller?.enqueue(chunk)
      return
    }

    if (executionId) {
      logger.warn('execution error without attemptId dropped', { topicId: this.#topicId, executionId })
      return
    }

    const branches = [...this.#branches.values()].filter(
      (branch) => topicAttemptWatermark === undefined || branch.attemptId <= topicAttemptWatermark
    )
    this.#enqueueErrorToBranches(chunk, branches)
  }

  #enqueueErrorToBranches(chunk: CherryUIMessageChunk, branches: Branch[]): void {
    for (const branch of branches) {
      if (this.#branches.get(branch.attemptId) !== branch) continue
      if (!branch.closed) branch.controller?.enqueue(chunk)
    }
  }

  #emitTerminal(
    executionId: UniqueModelId,
    terminal: ExecutionTerminal,
    anchorMessageId?: string,
    attemptId?: number
  ): void {
    const attemptIds =
      attemptId !== undefined
        ? [toAttemptId(attemptId)]
        : [...this.#branches.values()]
            .filter((branch) => branch.executionId === executionId)
            .map((branch) => branch.attemptId)

    if (attemptIds.length === 0) {
      for (const listener of this.#terminalListeners) {
        try {
          listener(executionId, terminal)
        } catch (err) {
          logger.warn('terminal listener threw', { topicId: this.#topicId, err })
        }
      }
      return
    }

    for (const id of attemptIds) {
      if (this.#terminalByAttemptId.has(id)) continue
      const branch = this.#branches.get(id)
      if (branch) this.#closeBranch(branch)
      const resolvedAnchorMessageId = anchorMessageId ?? branch?.anchorMessageId
      const terminalForBranch: ExecutionTerminal = {
        ...terminal,
        attemptId: id,
        ...(resolvedAnchorMessageId !== undefined ? { anchorMessageId: resolvedAnchorMessageId } : {})
      }
      this.#projection.settle({ executionId, attemptId: id, anchorMessageId: resolvedAnchorMessageId })
      this.#terminalByAttemptId.set(id, { executionId, terminal: terminalForBranch })
      for (const listener of this.#terminalListeners) {
        try {
          listener(executionId, terminalForBranch)
        } catch (err) {
          logger.warn('terminal listener threw', { topicId: this.#topicId, err })
        }
      }
    }
  }

  #terminateAll(terminal: ExecutionTerminal): void {
    this.#terminateBranches([...this.#branches.values()], terminal)
  }

  #applyTerminal(
    executionId: UniqueModelId | undefined,
    terminal: ExecutionTerminal,
    anchorMessageId?: string,
    attemptId?: number,
    topicAttemptWatermark?: number
  ): void {
    if (topicAttemptWatermark === undefined) {
      if (executionId) this.#emitTerminal(executionId, terminal, anchorMessageId, attemptId)
      else this.#terminateAll(terminal)
      return
    }

    this.#projection.advanceWatermark(topicAttemptWatermark)
    const exactAttemptId = attemptId === undefined ? undefined : toAttemptId(attemptId)
    const coveredBranches = [...this.#branches.values()]
      .filter((branch) => branch.attemptId <= topicAttemptWatermark)
      .filter((branch) => branch.attemptId !== exactAttemptId)

    if (executionId) {
      this.#retireBranches(coveredBranches)
      this.#emitTerminal(executionId, terminal, anchorMessageId, attemptId)
    } else {
      this.#terminateBranches(coveredBranches, terminal)
    }
  }

  #retireBranches(branches: Branch[]): void {
    const identities = branches.map(({ executionId, attemptId, anchorMessageId }) => ({
      executionId,
      attemptId,
      ...(anchorMessageId !== undefined ? { anchorMessageId } : {})
    }))
    if (identities.length === 0) return

    for (const listener of this.#branchRetirementListeners) {
      try {
        listener(identities)
      } catch (err) {
        logger.warn('branch retirement listener threw', { topicId: this.#topicId, err })
      }
    }

    for (const branch of branches) {
      if (this.#branches.get(branch.attemptId) !== branch) continue
      this.#closeBranch(branch)
      this.#branches.delete(branch.attemptId)
      this.#terminalByAttemptId.delete(branch.attemptId)
    }
  }

  #terminateBranches(branches: Branch[], terminal: ExecutionTerminal): void {
    for (const branch of branches) {
      if (this.#branches.get(branch.attemptId) !== branch) continue
      this.#emitTerminal(branch.executionId, terminal, branch.anchorMessageId, branch.attemptId)
    }
  }

  #updateTopicOpen(isTopicDone: boolean | undefined): boolean {
    if (isTopicDone === undefined) return false
    const topicOpen = !isTopicDone
    if (topicOpen === this.#topicOpen) return false
    this.#topicOpen = topicOpen
    return true
  }

  #notifyTopicStateChange(): void {
    for (const listener of this.#topicStateListeners) {
      try {
        listener()
      } catch (err) {
        logger.warn('topic state listener threw', { topicId: this.#topicId, err })
      }
    }
  }

  #notifyTopicQuiesced(event: TopicQuiescedProjectionEvent): void {
    this.#lastQuiesced = event
    for (const listener of this.#topicQuiescedListeners) {
      try {
        listener(event)
      } catch (err) {
        logger.warn('topic quiesced listener threw', { topicId: this.#topicId, err })
      }
    }
  }

  #receiveLegacy(event: () => void): void {
    if (this.#protocol === 'v2') return
    if (this.#protocol === 'pending') {
      this.#pendingLegacyEvents.push(event)
      return
    }
    event()
  }

  #receiveProtocolEvent(event: StreamProtocolEvent): void {
    if (event.topicId !== this.#topicId || this.#protocol === 'legacy') return
    if (this.#protocol === 'pending') {
      this.#pendingProtocolEvents.push(event)
      return
    }
    this.#applyProtocolEvent(event)
  }

  #applyProtocolEvent(
    event: StreamProtocolEvent | StreamProtocolReplayChunkEvent,
    source: 'live' | 'snapshot-replay' = 'live'
  ): void {
    if (this.#cycleId !== undefined && event.cycleId < this.#cycleId) return
    if (this.#cycleId === undefined || event.cycleId > this.#cycleId) {
      this.#cycleId = event.cycleId
      this.#controlRevision = 0
      this.#lastChunkSeq.clear()
      this.#lastQuiesced = undefined
      // Main opened a new topic cycle: branches classified to an older cycle are dead
      // authority; unclassified ones may be this cycle's own not-yet-evidenced registrations.
      this.#retireBranches(
        [...this.#branches.values()].filter(
          (branch) => branch.cycleId !== undefined && branch.cycleId !== event.cycleId
        )
      )
    }
    if (event.type === 'chunk') {
      if (source === 'snapshot-replay' && 'synthetic' in event && event.synthetic) {
        this.#routeChunk(event)
        return
      }
      const attemptId = toAttemptId(event.attemptId)
      const lastChunkSeq = this.#lastChunkSeq.get(attemptId) ?? 0
      if (event.throughChunkSeq <= lastChunkSeq) return
      if (event.chunkSeq <= lastChunkSeq) {
        logger.warn('overlapping stream chunk range dropped', {
          topicId: this.#topicId,
          attemptId,
          chunkSeq: event.chunkSeq,
          throughChunkSeq: event.throughChunkSeq,
          lastChunkSeq
        })
        return
      }
      this.#lastChunkSeq.set(attemptId, event.throughChunkSeq)
      const topicStateChanged = source === 'live' && !this.#topicOpen
      if (source === 'live') {
        this.#topicOpen = true
        this.#lastQuiesced = undefined
      }
      this.#routeChunk(event)
      if (topicStateChanged) this.#notifyTopicStateChange()
      return
    }

    if (event.controlRevision <= this.#controlRevision) return
    this.#controlRevision = event.controlRevision

    if (event.type === 'attempt-durably-settled') {
      if (event.outcome === 'error' && event.error) {
        this.#enqueueError(event.error, event.executionId, event.anchorMessageId, event.attemptId)
      }
      this.#emitTerminal(
        event.executionId,
        {
          attemptId: toAttemptId(event.attemptId),
          anchorMessageId: event.anchorMessageId,
          isAbort: event.outcome === 'paused',
          isError: event.outcome === 'error'
        },
        event.anchorMessageId,
        event.attemptId
      )
      return
    }

    this.#projection.advanceWatermark(event.throughAttemptId)
    this.#retireCoveredBranches(event.throughAttemptId)
    const topicStateChanged = this.#topicOpen
    this.#topicOpen = false
    if (topicStateChanged) this.#notifyTopicStateChange()
    this.#notifyTopicQuiesced({ cycleId: event.cycleId, throughAttemptId: event.throughAttemptId })
  }

  /** The quiesce barrier covers every attempt ≤ `throughAttemptId`; a covered
   *  branch that never saw its own terminal is stale and must not stay open. */
  #retireCoveredBranches(throughAttemptId: number): void {
    this.#retireBranches(
      [...this.#branches.values()].filter(
        (branch) => branch.attemptId <= throughAttemptId && !this.#terminalByAttemptId.has(branch.attemptId)
      )
    )
  }

  #selectV2Protocol(snapshot: StreamAttachSnapshot): void {
    // Mirror the live-path newer-only guard: a reattach can race a live cycle bump,
    // and a snapshot of an already-superseded cycle is dead authority — ignore it wholly.
    if (this.#cycleId !== undefined && snapshot.cycleId < this.#cycleId) return
    this.#protocol = 'v2'
    this.#cycleId = snapshot.cycleId
    this.#controlRevision = snapshot.controlRevision
    this.#pendingLegacyEvents.length = 0
    this.#topicOpen = snapshot.topicOpen
    this.#lastQuiesced = undefined

    // The snapshot is the authority on which attempts exist in this cycle.
    // Branches registered from a stale projection (older cycle, replaced slot)
    // are absent from it and must retire; surviving branches adopt the cycle.
    const snapshotAttemptIds = new Set(snapshot.attempts.map((attempt) => toAttemptId(attempt.attemptId)))
    this.#retireBranches([...this.#branches.values()].filter((branch) => !snapshotAttemptIds.has(branch.attemptId)))
    for (const branch of this.#branches.values()) branch.cycleId = snapshot.cycleId

    for (const attempt of snapshot.attempts) {
      for (const event of [...attempt.replayChunks].sort((left, right) => {
        const sequenceOrder = left.chunkSeq - right.chunkSeq
        if (sequenceOrder !== 0) return sequenceOrder
        return Number(right.synthetic === true) - Number(left.synthetic === true)
      })) {
        this.#applyProtocolEvent(event, 'snapshot-replay')
      }
      const attemptId = toAttemptId(attempt.attemptId)
      this.#lastChunkSeq.set(attemptId, Math.max(this.#lastChunkSeq.get(attemptId) ?? 0, attempt.throughChunkSeq))
      if (attempt.phase === 'settled' && attempt.outcome) {
        if (attempt.outcome === 'error' && attempt.error) {
          this.#enqueueError(attempt.error, attempt.executionId, attempt.anchorMessageId, attempt.attemptId)
        }
        this.#emitTerminal(
          attempt.executionId,
          {
            attemptId: toAttemptId(attempt.attemptId),
            anchorMessageId: attempt.anchorMessageId,
            isAbort: attempt.outcome === 'paused',
            isError: attempt.outcome === 'error'
          },
          attempt.anchorMessageId,
          attempt.attemptId
        )
      }
    }

    const pending = this.#pendingProtocolEvents.splice(0).filter((event) => event.cycleId >= snapshot.cycleId)
    // Total order (chunks < controls, then attemptId, then chunkSeq) — an inconsistent
    // comparator makes sort implementation-defined and can shuffle a single attempt's
    // chunks, which the chunkSeq dedup below would then silently drop.
    pending.sort((left, right) => {
      if (left.type === 'chunk' && right.type === 'chunk') {
        if (left.attemptId !== right.attemptId) return left.attemptId - right.attemptId
        return left.chunkSeq - right.chunkSeq
      }
      if (left.type !== 'chunk' && right.type !== 'chunk') return left.controlRevision - right.controlRevision
      return left.type === 'chunk' ? -1 : 1
    })
    for (const event of pending) this.#applyProtocolEvent(event)
    if (!this.#topicOpen && !this.#lastQuiesced) {
      const throughAttemptId = Math.max(0, ...snapshot.attempts.map((attempt) => attempt.attemptId))
      this.#retireCoveredBranches(throughAttemptId)
      this.#notifyTopicQuiesced({ cycleId: snapshot.cycleId, throughAttemptId })
    }
  }

  #selectLegacyProtocol(bufferedChunks: readonly StreamChunkPayload[]): void {
    this.#protocol = 'legacy'
    this.#pendingProtocolEvents.length = 0
    for (const payload of bufferedChunks) this.#routeChunk(payload)
    for (const event of this.#pendingLegacyEvents.splice(0)) event()
  }

  #setupIpcListeners(): void {
    if (this.#ipcUnsubs.length > 0) return
    this.#ipcUnsubs.push(
      ipcApi.on('ai.stream.event', (data) => this.#receiveProtocolEvent(data)),
      ipcApi.on('ai.stream.chunk', (data) => this.#receiveLegacy(() => this.#routeChunk(data))),
      ipcApi.on('ai.stream.done', (data) => {
        if (data.topicId !== this.#topicId) return
        // Advance the fence EAGERLY (monotonic, so safe under either protocol): attach replay
        // is routed before this deferred thunk runs, and covered attempts must not resurface.
        if (data.isTopicDone && data.topicAttemptWatermark !== undefined) {
          this.#projection.advanceWatermark(data.topicAttemptWatermark)
        }
        this.#receiveLegacy(() => {
          const topicStateChanged = this.#updateTopicOpen(data.isTopicDone)
          const terminal: ExecutionTerminal = {
            ...(data.attemptId !== undefined ? { attemptId: toAttemptId(data.attemptId) } : {}),
            isAbort: data.status === 'paused',
            isError: false
          }
          this.#applyTerminal(
            data.executionId,
            terminal,
            data.anchorMessageId,
            data.attemptId,
            data.isTopicDone ? data.topicAttemptWatermark : undefined
          )
          if (topicStateChanged) this.#notifyTopicStateChange()
          if (data.isTopicDone) {
            this.#notifyTopicQuiesced({ throughAttemptId: data.topicAttemptWatermark ?? data.attemptId ?? 0 })
          }
        })
      }),
      ipcApi.on('ai.stream.error', (data) => {
        if (data.topicId !== this.#topicId) return
        if (data.isTopicDone && data.topicAttemptWatermark !== undefined) {
          this.#projection.advanceWatermark(data.topicAttemptWatermark)
        }
        this.#receiveLegacy(() => {
          const topicStateChanged = this.#updateTopicOpen(data.isTopicDone)
          this.#enqueueError(
            data.error,
            data.executionId,
            data.anchorMessageId,
            data.attemptId,
            data.isTopicDone ? data.topicAttemptWatermark : undefined
          )
          const terminal: ExecutionTerminal = {
            ...(data.attemptId !== undefined ? { attemptId: toAttemptId(data.attemptId) } : {}),
            isAbort: false,
            isError: true
          }
          this.#applyTerminal(
            data.executionId,
            terminal,
            data.anchorMessageId,
            data.attemptId,
            data.isTopicDone ? data.topicAttemptWatermark : undefined
          )
          if (topicStateChanged) this.#notifyTopicStateChange()
          if (data.isTopicDone) {
            this.#notifyTopicQuiesced({ throughAttemptId: data.topicAttemptWatermark ?? data.attemptId ?? 0 })
          }
        })
      })
    )
  }

  async #ensureAttached(): Promise<void> {
    if (this.#attached || this.#attachInFlight || this.#disposed) return this.#attachInFlight ?? undefined
    // Register IPC listeners BEFORE attaching so live chunks Main emits the
    // instant its listener registers are not missed.
    this.#setupIpcListeners()
    const branchesAtAttach = [...this.#branches.values()]
    this.#attachInFlight = (async () => {
      let shouldReattach = false
      try {
        const res = await ipcApi.request('ai.stream.attach', { topicId: this.#topicId })
        if (this.#disposed) return
        this.#attached = true
        switch (res.status) {
          case 'attached':
            if (res.snapshot) {
              this.#selectV2Protocol(res.snapshot)
            } else {
              this.#selectLegacyProtocol(res.bufferedChunks)
            }
            break
          case 'not-found':
          case 'done':
            this.#selectLegacyProtocol([])
            this.#terminateBranches(branchesAtAttach, { isAbort: false, isError: false })
            break
          case 'paused':
            this.#selectLegacyProtocol([])
            this.#terminateBranches(branchesAtAttach, { isAbort: true, isError: false })
            break
          case 'error':
            this.#selectLegacyProtocol([])
            if (res.error) {
              this.#enqueueErrorToBranches({ type: 'data-error', data: { ...res.error } }, branchesAtAttach)
            }
            this.#terminateBranches(branchesAtAttach, { isAbort: false, isError: true })
            break
        }
        shouldReattach = res.status !== 'attached' && this.hasAnyOpenBranch()
        if (shouldReattach) this.#attached = false
        // If every execution unregistered while this attach was in flight, the
        // deferred-detach guard in `unregister` saw `#attached === false` and skipped,
        // so nothing else will release Main's listener. Detach now that attach resolved.
        if (this.#branches.size === 0 && !this.#disposed && !this.#topicOpen) this.#detach()
      } catch (err) {
        logger.error('streamAttach failed', { topicId: this.#topicId, err })
        // Close open branches so their readers finish with an error terminal
        // instead of hanging forever on a stream that never attached. Recovery
        // happens through a fresh subscription on the next mount.
        if (!this.#disposed) {
          this.#terminateBranches(branchesAtAttach, { isAbort: false, isError: true })
          shouldReattach = this.hasAnyOpenBranch()
        }
      } finally {
        this.#attachInFlight = null
        if (shouldReattach && !this.#disposed) void this.#ensureAttached()
      }
    })()
    return this.#attachInFlight
  }

  #detach(): void {
    if (!this.#attached) return
    void ipcApi.request('ai.stream.detach', { topicId: this.#topicId }).catch(() => {})
    this.#attached = false
    this.#attachInFlight = null
  }
}
