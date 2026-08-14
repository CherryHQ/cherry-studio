/**
 * Window-level owner of streaming overlay state shared by topic and agent-session
 * consumers (execution readers, live snapshots, interval-batched flushes). Extracted
 * from `useExecutionOverlay` so the overlay's lifetime is keyed by the transport
 * `topicId` routing scope instead of a component instance: while a stream is
 * running, route/tab/conversation switches release their view (refcount)
 * without tearing down readers or detaching the Main listener, and re-acquire
 * the retained view synchronously on remount. An idle entry (no running
 * reader) may drop on release — the next mount rebuilds from SQLite.
 *
 * Lifecycle rules:
 * - Readers start ONLY from a mounted consumer (`syncExecutions`), so the
 *   continue-safe seed rule (see reader notes below) applies unchanged.
 *   While no consumer is mounted, running readers keep assembling;
 *   executions that appear meanwhile get no reader — their chunks queue in
 *   `TopicStreamSubscription`'s auto-created branches (attached) or are
 *   replayed from Main's bounded buffer on the next attach (entry dropped);
 *   SQLite persistence is the durable fallback past the buffer.
 * - Terminal handoff is driven by TopicQuiesced. Mounted persistent consumers
 *   register a refresh port and retire snapshots only after it succeeds. With
 *   `refCount === 0`, no refresh consumer exists, so a
 *   naturally-finished execution drops its overlay immediately — the
 *   persisted DB row owns it. The entry drops once the last reader ends
 *   only after Main says the topic is done; `isTopicDone=false` keeps the
 *   attachment across the gap before a continuation emits its first chunk.
 *   Finished attempts stay fenced in `TopicStreamProjection`: a remount
 *   re-reporting a stale active set cannot restart them.
 * - `MAX_ENTRIES` LRU eviction of refCount-0 entries is a leak backstop
 *   (lost terminal events, abandoned routing scopes); it cancels readers
 *   first so a truncated stream is never reported as a successful finish.
 *
 * Reader semantics (moved from the hook): each execution gets a
 * one-shot `readUIMessageStream` reader with zero cross-turn state. The
 * reader is seeded with the message whose id is `anchorMessageId` taken from
 * the *current* DB truth supplied by the consumer; for a tool-approval /
 * continue the row already carries the prior assistant parts so a streamed
 * `tool-output` chunk can merge onto the matching `tool-input`. The seed is
 * re-derived on every reader start and never carried across turns — that,
 * plus a fresh reader per turn, is the structural anti-pollution guarantee.
 */
import { loggerService } from '@logger'
import { type AttemptId, toAttemptId } from '@shared/ai/attempt'
import type { ActiveExecution, ActiveNodeDecision } from '@shared/ai/transport'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import { isToolUIPart, readUIMessageStream } from 'ai'

import { projectActiveExecutions } from './TopicAttemptProjection'
import { TopicStreamSubscription } from './TopicStreamSubscription'

const logger = loggerService.withContext('ExecutionStreamOverlayService')

export interface ExecutionFinishEvent {
  attemptId: number
  message: CherryUIMessage
  isAbort: boolean
  isError: boolean
}

export interface ExecutionOverlayAttempt {
  attemptId: number
  phase: 'active' | 'settled'
  message: CherryUIMessage
  isAbort: boolean
  isError: boolean
}

export interface ExecutionOverlayActiveNodeOverride {
  previousActiveNodeId: string | null
  activeNodeId: string
}

interface ExecutionOverlayView {
  /** messageId -> latest streamed parts. messageId = anchorMessageId, or the
   *  start-chunk id when the execution has no pre-allocated row (temp topic). */
  overlay: Record<string, CherryMessagePart[]>
  /** Latest assistant snapshot per execution, in insertion order. */
  liveAssistants: CherryUIMessage[]
  /** One record per attempt. Terminal handoff updates the existing record in place. */
  attempts: ExecutionOverlayAttempt[]
  /** Command reservations retained until the quiesced DB refresh succeeds. */
  optimisticMessages: CherryUIMessage[]
  /** Main status plus command-receipt attempts, reconciled by AttemptId. */
  projectedExecutions: ActiveExecution[]
  activeNodeOverride: ExecutionOverlayActiveNodeOverride | null
  refreshError: Error | null
}

type FinishListener = (executionId: string, event: ExecutionFinishEvent) => void

interface ReaderHandle {
  executionId: UniqueModelId
  attemptId: AttemptId
  anchorMessageId?: string
  cancel: () => void
  unregister: () => void
}

interface PendingSnapshot {
  epoch: number
  readerVersion: number
  snapshot: CherryUIMessage
}

interface ConsumerContribution {
  executions: readonly ActiveExecution[]
  getSeedMessages: () => CherryUIMessage[]
}

interface ExecutionCandidate {
  execution: ActiveExecution
  seedFromEmpty?: boolean
  seed: ConsumerContribution
}

interface Entry {
  topicId: string
  sub: TopicStreamSubscription
  dropped: boolean
  refCount: number
  desired: Map<object, ConsumerContribution>
  optimisticMessages: Map<string, CherryUIMessage>
  optimisticMessageWatermarks: Map<string, AttemptId>
  optimisticExecutions: Map<AttemptId, ActiveExecution>
  optimisticSeeds: Map<AttemptId, () => CherryUIMessage[]>
  activeNodeOverride: ExecutionOverlayActiveNodeOverride | null
  refreshError: Error | null
  /** attemptId -> latest message snapshot. Retained after a reader tears
   *  down (final frame / Phase 2 last-good) until the same execution
   *  restarts, an explicit dispose, or the entry is dropped. */
  snapshots: Map<AttemptId, CherryUIMessage>
  settlements: Map<AttemptId, Pick<ExecutionFinishEvent, 'isAbort' | 'isError'>>
  view: ExecutionOverlayView
  pendingSnapshots: Map<AttemptId, PendingSnapshot>
  readerVersions: Map<AttemptId, number>
  readers: Map<AttemptId, ReaderHandle>
  /** In-flight reader loops. Kept separately from `readers` so cancellation
   *  can retire a handle before its async loop reaches `finally`. */
  liveReaderCount: number
  epoch: number
  commitTimer: number | null
  commitDeadline: number | null
  /** performance.now() of the last snapshot commit — enforces commitIntervalMs(). */
  lastCommitAt: number
  listeners: Set<() => void>
  finishListeners: Set<FinishListener>
  lastActiveAt: number
  /** Set when refCount hits 0. The next syncExecutions reconciles: snapshots
   *  whose execution is no longer active are dropped, because the terminal
   *  status edge that normally hands them off to the DB row is tracked per
   *  component instance and was unobservable while unmounted. Executions
   *  still streaming keep their snapshots — that continuity is the point. */
  needsRemountReconcile: boolean
}

const MAX_ENTRIES = 32
/** Commit cadence floor/ceiling. Each commit re-runs O(message size) render work (content
 *  transforms + markdown re-lex), so the interval scales with snapshot size to keep the
 *  per-second work bounded — a fixed cadence still melts the renderer as the message grows. */
const MIN_COMMIT_INTERVAL_MS = 100
const MAX_COMMIT_INTERVAL_MS = 3000
const COMMIT_CHARS_PER_MS = 2000

function commitIntervalMs(pending: Iterable<PendingSnapshot>): number {
  let chars = 0
  for (const item of pending) {
    for (const part of item.snapshot.parts ?? []) {
      const text = (part as { text?: unknown }).text
      if (typeof text === 'string') chars += text.length
    }
  }
  return Math.min(MAX_COMMIT_INTERVAL_MS, Math.max(MIN_COMMIT_INTERVAL_MS, chars / COMMIT_CHARS_PER_MS))
}
// Frozen: its reference identity is what keeps useSyncExternalStore stable,
// so a consumer mutation would silently poison every topic in the window.
const EMPTY_VIEW: ExecutionOverlayView = Object.freeze({
  overlay: Object.freeze({}),
  liveAssistants: Object.freeze([]) as unknown as CherryUIMessage[],
  attempts: Object.freeze([]) as unknown as ExecutionOverlayAttempt[],
  optimisticMessages: Object.freeze([]) as unknown as CherryUIMessage[],
  projectedExecutions: Object.freeze([]) as unknown as ActiveExecution[],
  activeNodeOverride: null,
  refreshError: null
})

function pickSeed(
  uiMessages: CherryUIMessage[],
  anchorMessageId?: string,
  seedFromEmpty = false
): CherryUIMessage | undefined {
  if (!anchorMessageId) return undefined
  if (seedFromEmpty) return { id: anchorMessageId, role: 'assistant', parts: [] } as CherryUIMessage
  const found = uiMessages.find((m) => m.id === anchorMessageId)
  if (!found) {
    return { id: anchorMessageId, role: 'assistant', parts: [] } as CherryUIMessage
  }
  // readUIMessageStream mutates `message.parts` in place. `found` is the live, render-stable
  // SWR-derived row whose `parts` array aliases the SWR cache, so seeding the reader with it
  // would corrupt cached history and race the DB-authoritative refresh(). Clone the parts so
  // the reader only ever writes to a throwaway. (DB parts are JSON-serializable.)
  return { ...found, parts: structuredClone(found.parts ?? []) }
}

function canReuseSettledPart(previous: CherryMessagePart, next: CherryMessagePart): boolean {
  if (previous.type !== next.type) return false

  if (previous.type === 'text' && next.type === 'text') {
    return previous.state !== 'streaming' && next.state !== 'streaming' && previous.text === next.text
  }

  if (previous.type === 'reasoning' && next.type === 'reasoning') {
    return previous.state !== 'streaming' && next.state !== 'streaming' && previous.text === next.text
  }

  if (isToolUIPart(previous) && isToolUIPart(next)) {
    const previousTool = previous as unknown as { preliminary?: boolean; state?: string; toolCallId?: string }
    const nextTool = next as unknown as { preliminary?: boolean; state?: string; toolCallId?: string }
    if (previousTool.toolCallId !== nextTool.toolCallId || previousTool.state !== nextTool.state) return false
    if (previousTool.state === 'output-available') {
      return previousTool.preliminary !== true && nextTool.preliminary !== true
    }
    return (
      previousTool.state === 'output-error' ||
      previousTool.state === 'output-denied' ||
      previousTool.state === 'cancelled'
    )
  }

  // These transport parts are append-only in processUIMessageStream. Data
  // parts are deliberately excluded because an id-bearing data part can be
  // updated in place by a later chunk.
  return (
    previous.type === 'file' ||
    previous.type === 'source-url' ||
    previous.type === 'source-document' ||
    previous.type === 'step-start'
  )
}

/**
 * `readUIMessageStream` clones the complete message for every chunk. Restore
 * references for protocol-settled parts so rendering work stays proportional
 * to the live frontier instead of the full accumulated transcript.
 */
function shareSettledPartReferences(
  previous: CherryMessagePart[] | undefined,
  next: CherryMessagePart[]
): CherryMessagePart[] {
  if (!previous || previous.length === 0 || next.length === 0) return next

  let reusedAny = false
  let reusedAll = previous.length === next.length
  const shared = next.map((part, index) => {
    const previousPart = previous[index]
    if (previousPart === part || (previousPart && canReuseSettledPart(previousPart, part))) {
      reusedAny = true
      return previousPart
    }
    reusedAll = false
    return part
  })

  if (reusedAll) return previous
  return reusedAny ? shared : next
}

function computeView(
  snapshots: ReadonlyMap<AttemptId, CherryUIMessage>,
  settlements: ReadonlyMap<AttemptId, Pick<ExecutionFinishEvent, 'isAbort' | 'isError'>>,
  optimisticMessages: ReadonlyMap<string, CherryUIMessage>,
  projectedExecutions: ActiveExecution[],
  activeNodeOverride: ExecutionOverlayActiveNodeOverride | null,
  refreshError: Error | null
): ExecutionOverlayView {
  const overlay: Record<string, CherryMessagePart[]> = {}
  for (const snapshot of snapshots.values()) {
    if (snapshot?.parts?.length) overlay[snapshot.id] = snapshot.parts as CherryMessagePart[]
  }
  const liveAssistants = [...snapshots.values()].filter((s): s is CherryUIMessage => s?.role === 'assistant')
  const attempts = [...snapshots].flatMap(([attemptId, message]) => {
    if (message.role !== 'assistant') return []
    const terminal = settlements.get(attemptId)
    return [
      {
        attemptId,
        phase: terminal ? ('settled' as const) : ('active' as const),
        message,
        isAbort: terminal?.isAbort ?? false,
        isError: terminal?.isError ?? false
      }
    ]
  })
  return {
    overlay,
    liveAssistants,
    attempts,
    optimisticMessages: [...optimisticMessages.values()],
    projectedExecutions,
    activeNodeOverride,
    refreshError
  }
}

export class ExecutionStreamOverlayService {
  readonly #entries = new Map<string, Entry>()

  acquire(topicId: string): void {
    const entry = this.#getOrCreate(topicId)
    entry.refCount += 1
    entry.lastActiveAt = Date.now()
    // A hidden window's commit timer may be delayed with snapshots pending; materialize
    // them so the re-acquiring consumer's first read sees the latest state.
    this.#flushPending(entry, entry.epoch)
  }

  release(topicId: string, consumer: object): void {
    const entry = this.#entries.get(topicId)
    if (!entry) return
    // Remove the contribution WITHOUT converging readers: departure must not
    // cancel them — surviving unmount is the point of this service. Settled
    // keys are also kept: pruning them here (when this was the last consumer)
    // would let a remount with a temporarily stale active set restart a
    // finished execution and wipe its retained final frame. syncExecutions
    // prunes them against the union once fresh state arrives.
    entry.desired.delete(consumer)
    entry.refCount = Math.max(0, entry.refCount - 1)
    if (entry.refCount === 0) entry.needsRemountReconcile = true
    this.#maybeDrop(entry)
  }

  /** Converge readers to the union of mounted consumers' active executions.
   *  Same convergence the hook's effect ran: leaving executions get their
   *  reader cancelled (suppressing onFinish — the status-driven handoff owns
   *  that path), new ones start a fresh seeded reader. */
  syncExecutions(
    topicId: string,
    consumer: object,
    executions: readonly ActiveExecution[],
    getSeedMessages: () => CherryUIMessage[]
  ): void {
    const entry = this.#entries.get(topicId)
    if (!entry) return
    entry.desired.set(consumer, { executions, getSeedMessages })

    const candidates = new Map<AttemptId, ExecutionCandidate>()
    for (const [attemptId, execution] of entry.optimisticExecutions) {
      const getSeedMessages = entry.optimisticSeeds.get(attemptId)
      if (!getSeedMessages) continue
      candidates.set(attemptId, {
        execution,
        seedFromEmpty: execution.seedFromEmpty,
        seed: { executions: [execution], getSeedMessages }
      })
    }
    for (const contribution of entry.desired.values()) {
      for (const execution of contribution.executions) {
        const attemptId = toAttemptId(execution.attemptId)
        const existing = candidates.get(attemptId)
        if (!existing) {
          candidates.set(attemptId, { execution, seedFromEmpty: execution.seedFromEmpty, seed: contribution })
        } else if (execution.seedFromEmpty && !existing.seedFromEmpty) {
          candidates.set(attemptId, { ...existing, seedFromEmpty: true })
        }
      }
    }
    const union = new Map<AttemptId, ExecutionCandidate>()
    for (const execution of projectActiveExecutions([...candidates.values()].map((candidate) => candidate.execution))) {
      const attemptId = toAttemptId(execution.attemptId)
      const candidate = candidates.get(attemptId)
      if (candidate) union.set(attemptId, candidate)
    }

    if (entry.needsRemountReconcile) {
      entry.needsRemountReconcile = false
      const liveAttemptIds = new Set([...union.keys(), ...entry.readers.keys()])
      let next = entry.snapshots
      for (const attemptId of entry.snapshots.keys()) {
        if (liveAttemptIds.has(attemptId)) continue
        entry.pendingSnapshots.delete(attemptId)
        entry.settlements.delete(attemptId)
        entry.readerVersions.set(attemptId, (entry.readerVersions.get(attemptId) ?? 0) + 1)
        if (next === entry.snapshots) next = new Map(entry.snapshots)
        next.delete(attemptId)
      }
      this.#commitSnapshots(entry, next)
    }

    for (const [key, handle] of [...entry.readers]) {
      if (union.has(key)) continue
      // Main's finalizing broadcast removes the attempt from activeExecutions
      // before persistence. Keep its transport reader until the settled terminal
      // fence closes the branch, so the overlay survives the handoff window.
      if (!entry.sub.isSettled(key)) continue
      handle.cancel()
      handle.unregister()
      entry.readers.delete(key)
    }

    for (const [attemptId, item] of union) {
      if (entry.readers.has(attemptId) || entry.sub.isSettled(attemptId)) continue
      const { executionId, anchorMessageId } = item.execution
      this.#startReader(entry, attemptId, executionId, anchorMessageId, item.seedFromEmpty, item.seed.getSeedMessages)
    }
    this.#publishView(entry)
  }

  subscribe(topicId: string, listener: () => void): () => void {
    const entry = this.#entries.get(topicId)
    if (!entry) return () => {}
    entry.listeners.add(listener)
    return () => entry.listeners.delete(listener)
  }

  getView(topicId: string): ExecutionOverlayView {
    return this.#entries.get(topicId)?.view ?? EMPTY_VIEW
  }

  seedReservations(
    topicId: string,
    messages: readonly CherryUIMessage[],
    executions: readonly ActiveExecution[],
    activeNodeDecision: ActiveNodeDecision | undefined,
    previousActiveNodeId: string | null,
    getSeedMessages: () => CherryUIMessage[]
  ): void {
    const entry = this.#entries.get(topicId)
    if (!entry) return
    const reservationWatermark = toAttemptId(Math.max(0, ...executions.map((execution) => execution.attemptId)))
    for (const message of messages) {
      entry.optimisticMessages.set(message.id, message)
      entry.optimisticMessageWatermarks.set(message.id, reservationWatermark)
    }
    for (const execution of executions) {
      const attemptId = toAttemptId(execution.attemptId)
      entry.optimisticExecutions.set(attemptId, execution)
      entry.optimisticSeeds.set(attemptId, getSeedMessages)
      if (!entry.readers.has(attemptId) && !entry.sub.isSettled(attemptId)) {
        this.#startReader(
          entry,
          attemptId,
          execution.executionId,
          execution.anchorMessageId,
          execution.seedFromEmpty,
          getSeedMessages
        )
      }
    }
    if (activeNodeDecision?.move !== 'keep') {
      const activeNodeId = messages.at(-1)?.id
      if (activeNodeId) entry.activeNodeOverride = { previousActiveNodeId, activeNodeId }
    }
    this.#publishView(entry)
  }

  onFinish(topicId: string, listener: FinishListener): () => void {
    const entry = this.#entries.get(topicId)
    if (!entry) return () => {}
    entry.finishListeners.add(listener)
    return () => entry.finishListeners.delete(listener)
  }

  onTopicQuiesced(topicId: string, listener: Parameters<TopicStreamSubscription['onTopicQuiesced']>[0]): () => void {
    const entry = this.#entries.get(topicId)
    if (!entry) return () => {}
    return entry.sub.onTopicQuiesced(listener)
  }

  setRefreshError(topicId: string, error: Error | null): void {
    const entry = this.#entries.get(topicId)
    if (!entry || entry.refreshError === error) return
    entry.refreshError = error
    this.#publishView(entry)
  }

  /** Drop one overlay/snapshot entry by its message id (post-persist handoff).
   *  Skipped when the execution has a live reader: `#startReader` already
   *  replaced the old snapshot, so the state now belongs to the newer turn and
   *  a delayed handoff for the finished one must not invalidate it. */
  disposeOverlay(topicId: string, messageId: string): void {
    const entry = this.#entries.get(topicId)
    if (!entry) return
    const snapshotEntry = [...entry.snapshots].find(([, snapshot]) => snapshot.id === messageId)
    const pendingEntry = [...entry.pendingSnapshots].find(([, item]) => item.snapshot.id === messageId)
    const attemptId = snapshotEntry?.[0] ?? pendingEntry?.[0]
    if (attemptId === undefined || entry.readers.has(attemptId)) return
    entry.pendingSnapshots.delete(attemptId)
    entry.settlements.delete(attemptId)
    entry.readerVersions.set(attemptId, (entry.readerVersions.get(attemptId) ?? 0) + 1)
    if (entry.pendingSnapshots.size === 0) this.#cancelFrame(entry)
    if (snapshotEntry) {
      const next = new Map(entry.snapshots)
      next.delete(snapshotEntry[0])
      this.#commitSnapshots(entry, next)
    }
  }

  /** Drop settled overlay/snapshot entries for a routing scope (terminal handoff).
   *  Executions with a live reader are left untouched: a delayed handoff for a
   *  finished turn must not freeze a newer turn already streaming on this topic. */
  reset(topicId: string): void {
    const entry = this.#entries.get(topicId)
    if (!entry) return
    const settled = (attemptId: AttemptId) => entry.settlements.has(attemptId) || entry.sub.isSettled(attemptId)
    this.#retire(entry, settled, settled)
  }

  /** Retire only records covered by one cycle's durable barrier. */
  retireThrough(topicId: string, throughAttemptId: number): void {
    const entry = this.#entries.get(topicId)
    if (!entry) return
    const watermark = toAttemptId(throughAttemptId)
    const covered = (attemptId: AttemptId) => attemptId <= watermark
    this.#retire(entry, covered, covered)
  }

  #retire(entry: Entry, coversAttempt: (id: AttemptId) => boolean, coversMessage: (id: AttemptId) => boolean): void {
    let next = entry.snapshots
    for (const attemptId of new Set([...entry.snapshots.keys(), ...entry.pendingSnapshots.keys()])) {
      if (!coversAttempt(attemptId)) continue
      const handle = entry.readers.get(attemptId)
      if (handle) {
        handle.cancel()
        handle.unregister()
        entry.readers.delete(attemptId)
      }
      entry.pendingSnapshots.delete(attemptId)
      entry.settlements.delete(attemptId)
      entry.optimisticExecutions.delete(attemptId)
      entry.optimisticSeeds.delete(attemptId)
      entry.readerVersions.set(attemptId, (entry.readerVersions.get(attemptId) ?? 0) + 1)
      if (next.has(attemptId)) {
        if (next === entry.snapshots) next = new Map(entry.snapshots)
        next.delete(attemptId)
      }
    }
    for (const [messageId, messageWatermark] of entry.optimisticMessageWatermarks) {
      if (!coversMessage(messageWatermark)) continue
      entry.optimisticMessageWatermarks.delete(messageId)
      entry.optimisticMessages.delete(messageId)
      if (entry.activeNodeOverride?.activeNodeId === messageId) entry.activeNodeOverride = null
    }
    if (entry.pendingSnapshots.size === 0) this.#cancelFrame(entry)
    if (next === entry.snapshots) this.#publishView(entry)
    else this.#commitSnapshots(entry, next)
  }

  /** Destructively drop every overlay/snapshot entry, including live readers'
   *  future frames (quick-assistant clear()). Not for terminal handoff. */
  clear(topicId: string): void {
    const entry = this.#entries.get(topicId)
    if (!entry) return
    this.#invalidatePending(entry)
    entry.readerVersions.clear()
    entry.settlements.clear()
    entry.optimisticMessages.clear()
    entry.optimisticMessageWatermarks.clear()
    entry.optimisticExecutions.clear()
    entry.optimisticSeeds.clear()
    entry.activeNodeOverride = null
    entry.refreshError = null
    if (entry.snapshots.size > 0) this.#commitSnapshots(entry, new Map())
    else this.#publishView(entry)
  }

  // ── internals ──────────────────────────────────────────────────────

  #getOrCreate(topicId: string): Entry {
    let entry = this.#entries.get(topicId)
    if (entry) return entry
    this.#evictIfNeeded()
    const sub = new TopicStreamSubscription(topicId)
    if (topicId) sub.listen()
    entry = {
      topicId,
      sub,
      dropped: false,
      refCount: 0,
      desired: new Map(),
      optimisticMessages: new Map(),
      optimisticMessageWatermarks: new Map(),
      optimisticExecutions: new Map(),
      optimisticSeeds: new Map(),
      activeNodeOverride: null,
      refreshError: null,
      snapshots: new Map(),
      settlements: new Map(),
      view: EMPTY_VIEW,
      pendingSnapshots: new Map(),
      readerVersions: new Map(),
      readers: new Map(),
      liveReaderCount: 0,
      epoch: 0,
      commitTimer: null,
      commitDeadline: null,
      lastCommitAt: 0,
      listeners: new Set(),
      finishListeners: new Set(),
      lastActiveAt: Date.now(),
      needsRemountReconcile: false
    }
    this.#entries.set(topicId, entry)
    // Re-check droppability when terminals close branches: an entry retained
    // only for unclaimed continuation chunks must not outlive their stream.
    sub.onExecutionTerminal(() => {
      if (this.#entries.get(topicId) === entry) this.#maybeDrop(entry)
    })
    sub.onBranchesRetired((branches) => {
      if (this.#entries.get(topicId) !== entry) return
      for (const branch of branches) {
        const { attemptId } = branch
        const handle = entry.readers.get(attemptId)
        if (handle) {
          handle.cancel()
          handle.unregister()
          entry.readers.delete(attemptId)
        }
        entry.pendingSnapshots.delete(attemptId)
        entry.settlements.delete(attemptId)
        entry.readerVersions.set(attemptId, (entry.readerVersions.get(attemptId) ?? 0) + 1)
        if (entry.snapshots.has(attemptId)) {
          const next = new Map(entry.snapshots)
          next.delete(attemptId)
          this.#commitSnapshots(entry, next)
        }
      }
      this.#maybeDrop(entry)
    })
    sub.onTopicStateChange(() => {
      if (this.#entries.get(topicId) === entry) this.#maybeDrop(entry)
    })
    return entry
  }

  #evictIfNeeded(): void {
    while (this.#entries.size >= MAX_ENTRIES) {
      let oldest: Entry | undefined
      for (const entry of this.#entries.values()) {
        if (entry.refCount > 0) continue
        if (!oldest || entry.lastActiveAt < oldest.lastActiveAt) oldest = entry
      }
      if (!oldest) return
      logger.error('evicting stale overlay entry', {
        topicId: oldest.topicId,
        entryCount: this.#entries.size,
        liveReaders: oldest.liveReaderCount,
        idleMs: Date.now() - oldest.lastActiveAt
      })
      // Cancel before dropping: dispose closes branches cleanly, and a still-
      // running reader would otherwise report the truncated stream as a
      // successful finish to onFinish consumers.
      for (const handle of oldest.readers.values()) handle.cancel()
      this.#dropEntry(oldest)
    }
  }

  #maybeDrop(entry: Entry): void {
    if (entry.refCount > 0 || entry.liveReaderCount > 0) return
    // A per-execution terminal with `isTopicDone=false` precedes scheduling
    // the continuation, so there can be no next branch yet. Keep the Main
    // attachment until an explicit topic terminal closes this ownership gap.
    if (entry.sub.isTopicOpen()) return
    // A continuation round's chunks may already be queuing in auto-created
    // transport branches before any reader claims them (hidden steer/agent
    // handoff: A ends with isTopicDone=false, B streams right after).
    // Dropping now would detach the topic mid-turn; the terminal that
    // eventually closes those branches re-runs this check.
    if (entry.sub.hasAnyOpenBranch()) return
    this.#dropEntry(entry)
  }

  #dropEntry(entry: Entry): void {
    if (entry.dropped) return
    entry.dropped = true
    if (this.#entries.get(entry.topicId) === entry) this.#entries.delete(entry.topicId)
    this.#cancelFrame(entry)
    entry.sub.dispose()
  }

  #startReader(
    entry: Entry,
    attemptId: AttemptId,
    executionId: UniqueModelId,
    anchorMessageId: string | undefined,
    seedFromEmpty: boolean | undefined,
    getSeedMessages: () => CherryUIMessage[]
  ): void {
    const branch = entry.sub.register(executionId, anchorMessageId, attemptId)
    if (!entry.sub.hasOpenBranch(executionId, anchorMessageId, attemptId)) {
      return
    }
    const readerEpoch = entry.epoch
    const readerVersion = (entry.readerVersions.get(attemptId) ?? 0) + 1
    entry.readerVersions.set(attemptId, readerVersion)
    entry.pendingSnapshots.delete(attemptId)
    entry.settlements.delete(attemptId)

    let cancelled = false
    let readerFailed = false
    let terminal: { isAbort: boolean; isError: boolean } | undefined
    const offTerminal = entry.sub.onExecutionTerminal((id, t) => {
      if (id !== executionId) return
      if (t.attemptId !== undefined && t.attemptId !== attemptId) return
      if (t.anchorMessageId !== undefined && t.anchorMessageId !== anchorMessageId) return
      terminal = t
    })
    const seed = pickSeed(getSeedMessages(), anchorMessageId, seedFromEmpty)
    const topicId = entry.topicId

    const handle: ReaderHandle = {
      executionId,
      attemptId,
      anchorMessageId,
      cancel: () => {
        cancelled = true
        entry.sub.cancelBranch(executionId, anchorMessageId, attemptId)
      },
      unregister: () => {
        offTerminal()
        entry.sub.unregister(executionId, anchorMessageId, attemptId)
      }
    }
    entry.readers.set(attemptId, handle)

    entry.liveReaderCount += 1
    void (async () => {
      let last: CherryUIMessage | undefined
      try {
        for await (const snapshot of readUIMessageStream<CherryUIMessage>({
          stream: branch,
          message: seed,
          terminateOnError: false,
          onError: (err) => {
            if (!cancelled) logger.warn('readUIMessageStream error', { topicId, executionId, err })
          }
        })) {
          if (cancelled) break
          const sharedParts = shareSettledPartReferences(
            last?.parts as CherryMessagePart[] | undefined,
            snapshot.parts as CherryMessagePart[]
          )
          const nextSnapshot = sharedParts === snapshot.parts ? snapshot : { ...snapshot, parts: sharedParts }
          last = nextSnapshot
          this.#queueSnapshot(entry, attemptId, nextSnapshot, readerEpoch, readerVersion)
        }
      } catch (err) {
        // A crashed reader must not be reported as a clean success: transport
        // terminals never reach it, so isError has to come from here.
        readerFailed = true
        logger.error('execution reader threw', { topicId, executionId, err })
      } finally {
        offTerminal()
        if (entry.readers.get(attemptId) === handle) {
          entry.sub.unregister(executionId, anchorMessageId, attemptId)
          entry.readers.delete(attemptId)
        }
        if (!cancelled) {
          if (entry.refCount === 0) {
            // Natural end in the background: the persisted DB row is the
            // authority and the next mount rebuilds from it — this
            // execution's overlay is not worth carrying.
            entry.pendingSnapshots.delete(attemptId)
            entry.settlements.delete(attemptId)
            entry.readerVersions.set(attemptId, (entry.readerVersions.get(attemptId) ?? 0) + 1)
            if (entry.snapshots.has(attemptId)) {
              const next = new Map(entry.snapshots)
              next.delete(attemptId)
              this.#commitSnapshots(entry, next)
            }
          } else {
            // Terminal frames must be visible before the overlay handoff. This
            // and the acquire()-time stall flush are the intentional commits
            // outside the interval cadence.
            this.#flushPending(entry, readerEpoch)
            const t = terminal ?? { isAbort: false, isError: false }
            const isError = t.isError || readerFailed
            const message = last ?? seed
            if (message || isError) {
              const event: ExecutionFinishEvent = {
                attemptId,
                message: message ?? { id: '', role: 'assistant', parts: [] },
                isAbort: t.isAbort,
                isError
              }
              this.#settleAttempt(entry, event)
              for (const listener of [...entry.finishListeners]) {
                try {
                  listener(executionId, event)
                } catch (err) {
                  logger.warn('finish listener threw', { topicId, executionId, err })
                }
              }
            }
          }
        }
        entry.liveReaderCount -= 1
        this.#maybeDrop(entry)
      }
    })()
  }

  #queueSnapshot(
    entry: Entry,
    attemptId: AttemptId,
    snapshot: CherryUIMessage,
    epoch: number,
    readerVersion: number
  ): void {
    if (epoch !== entry.epoch || entry.readerVersions.get(attemptId) !== readerVersion) return

    entry.pendingSnapshots.set(attemptId, { epoch, readerVersion, snapshot })
    const deadline = entry.lastCommitAt + commitIntervalMs(entry.pendingSnapshots.values())
    if (entry.commitTimer !== null) {
      if (entry.commitDeadline !== null && deadline <= entry.commitDeadline) return
      this.#cancelFrame(entry)
    }

    entry.commitDeadline = deadline
    const delay = Math.max(0, deadline - performance.now())
    entry.commitTimer = window.setTimeout(() => {
      entry.commitTimer = null
      entry.commitDeadline = null
      this.#flushPending(entry, epoch)
    }, delay)
  }

  #flushPending(entry: Entry, expectedEpoch: number): void {
    if (expectedEpoch !== entry.epoch) return

    this.#cancelFrame(entry)
    const pending = entry.pendingSnapshots
    if (pending.size === 0) return
    entry.pendingSnapshots = new Map()

    let next = entry.snapshots
    for (const [attemptId, item] of pending) {
      if (item.epoch !== entry.epoch) continue
      if (entry.readerVersions.get(attemptId) !== item.readerVersion) continue
      if (entry.snapshots.get(attemptId) === item.snapshot) continue
      if (next === entry.snapshots) next = new Map(entry.snapshots)
      next.set(attemptId, item.snapshot)
    }
    this.#commitSnapshots(entry, next)
  }

  #commitSnapshots(entry: Entry, next: Map<AttemptId, CherryUIMessage>): void {
    if (next === entry.snapshots) return
    entry.lastCommitAt = performance.now()
    entry.snapshots = next
    this.#publishView(entry)
  }

  #settleAttempt(entry: Entry, event: ExecutionFinishEvent): void {
    const attemptId = toAttemptId(event.attemptId)
    entry.settlements.set(attemptId, { isAbort: event.isAbort, isError: event.isError })
    entry.optimisticExecutions.delete(attemptId)
    entry.optimisticSeeds.delete(attemptId)
    this.#publishView(entry)
  }

  #publishView(entry: Entry): void {
    const projectedExecutions = projectActiveExecutions(
      [...entry.desired.values()].flatMap(({ executions }) => executions),
      [...entry.optimisticExecutions.values()]
    ).filter((execution) => !entry.sub.isSettled(execution.attemptId))
    entry.view = computeView(
      entry.snapshots,
      entry.settlements,
      entry.optimisticMessages,
      projectedExecutions,
      entry.activeNodeOverride,
      entry.refreshError
    )
    entry.lastActiveAt = Date.now()
    for (const listener of [...entry.listeners]) {
      try {
        listener()
      } catch (err) {
        logger.warn('overlay listener threw', { topicId: entry.topicId, err })
      }
    }
  }

  #invalidatePending(entry: Entry): void {
    entry.epoch += 1
    entry.pendingSnapshots.clear()
    this.#cancelFrame(entry)
  }

  #cancelFrame(entry: Entry): void {
    if (entry.commitTimer !== null) window.clearTimeout(entry.commitTimer)
    entry.commitTimer = null
    entry.commitDeadline = null
  }
}

export const executionStreamOverlayService = new ExecutionStreamOverlayService()
