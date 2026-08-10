/**
 * Window-level owner of streaming overlay state shared by topic and agent-session
 * consumers (execution readers, live snapshots, rAF-batched flushes). Extracted
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
 * - Terminal handoff is dual-mode. With a consumer mounted, the
 *   status-edge handoff (`useTopicOverlayHandoffOnTerminal` → refresh →
 *   `reset`) owns disposal, unchanged. With `refCount === 0`, the edge
 *   would be unobservable (it is tracked per component instance), so a
 *   naturally-finished execution drops its overlay immediately — the
 *   persisted DB row owns it. The entry drops once the last reader ends
 *   only after Main says the topic is done; `isTopicDone=false` keeps the
 *   attachment across the gap before a continuation emits its first chunk.
 *   Finished keys are tombstoned in `settledKeys`: a remount
 *   re-reporting a stale set cannot restart them; only an open transport
 *   branch holding a new turn's chunks overrides the tombstone.
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
import type { ActiveExecution } from '@shared/ai/transport'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import { isToolUIPart, readUIMessageStream } from 'ai'

import { TopicStreamSubscription } from './TopicStreamSubscription'

const logger = loggerService.withContext('ExecutionStreamOverlayService')

export interface ExecutionFinishEvent {
  attemptId?: string
  message: CherryUIMessage
  isAbort: boolean
  isError: boolean
}

interface ExecutionOverlayView {
  /** messageId -> latest streamed parts. messageId = anchorMessageId, or the
   *  start-chunk id when the execution has no pre-allocated row (temp topic). */
  overlay: Record<string, CherryMessagePart[]>
  /** Latest assistant snapshot per execution, in insertion order. */
  liveAssistants: CherryUIMessage[]
}

type FinishListener = (executionId: string, event: ExecutionFinishEvent) => void

interface ReaderHandle {
  executionId: UniqueModelId
  attemptId?: string
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

interface Entry {
  topicId: string
  sub: TopicStreamSubscription
  dropped: boolean
  refCount: number
  desired: Map<object, ConsumerContribution>
  /** executionId -> latest message snapshot. Retained after a reader tears
   *  down (final frame / Phase 2 last-good) until the same execution
   *  restarts, an explicit dispose, or the entry is dropped. */
  snapshots: Record<string, CherryUIMessage>
  view: ExecutionOverlayView
  pendingSnapshots: Map<string, PendingSnapshot>
  readerVersions: Map<string, number>
  readers: Map<string, ReaderHandle>
  /** Terminal reader keys that remain reported by a mounted consumer. Keep
   *  them satisfied until the key leaves the desired set so an overlay
   *  publication render cannot restart the just-finished execution. */
  settledKeys: Set<string>
  /** In-flight reader loops. Kept separately from `readers` so cancellation
   *  can retire a handle before its async loop reaches `finally`. */
  liveReaderCount: number
  epoch: number
  frameId: number | null
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
// Frozen: its reference identity is what keeps useSyncExternalStore stable,
// so a consumer mutation would silently poison every topic in the window.
const EMPTY_VIEW: ExecutionOverlayView = Object.freeze({
  overlay: Object.freeze({}),
  liveAssistants: Object.freeze([]) as unknown as CherryUIMessage[]
})

function executionKey(executionId: UniqueModelId, anchorMessageId?: string, attemptId?: string): string {
  return JSON.stringify([executionId, anchorMessageId ?? null, attemptId ?? null])
}

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

function computeView(snapshots: Record<string, CherryUIMessage>): ExecutionOverlayView {
  const overlay: Record<string, CherryMessagePart[]> = {}
  for (const snapshot of Object.values(snapshots)) {
    if (snapshot?.parts?.length) overlay[snapshot.id] = snapshot.parts as CherryMessagePart[]
  }
  const liveAssistants = Object.values(snapshots).filter((s): s is CherryUIMessage => s?.role === 'assistant')
  return { overlay, liveAssistants }
}

export class ExecutionStreamOverlayService {
  readonly #entries = new Map<string, Entry>()

  acquire(topicId: string): void {
    const entry = this.#getOrCreate(topicId)
    entry.refCount += 1
    entry.lastActiveAt = Date.now()
    // A hidden window's rAF may have stalled with frames pending; materialize
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

    const union = new Map<
      string,
      {
        executionId: UniqueModelId
        attemptId?: string
        anchorMessageId?: string
        seedFromEmpty?: boolean
        seed: ConsumerContribution
      }
    >()
    for (const contribution of entry.desired.values()) {
      for (const { executionId, attemptId, anchorMessageId, seedFromEmpty } of contribution.executions) {
        const key = executionKey(executionId, anchorMessageId, attemptId)
        const existing = union.get(key)
        if (!existing) {
          union.set(key, { executionId, attemptId, anchorMessageId, seedFromEmpty, seed: contribution })
        } else if (seedFromEmpty && !existing.seedFromEmpty) {
          union.set(key, { ...existing, seedFromEmpty: true })
        }
      }
    }

    for (const key of entry.settledKeys) {
      if (!union.has(key)) entry.settledKeys.delete(key)
    }

    if (entry.needsRemountReconcile) {
      entry.needsRemountReconcile = false
      const liveExecutionIds = new Set([...union.values()].map((item) => item.executionId as string))
      let next = entry.snapshots
      for (const executionId of Object.keys(entry.snapshots)) {
        if (liveExecutionIds.has(executionId)) continue
        entry.pendingSnapshots.delete(executionId)
        entry.readerVersions.set(executionId, (entry.readerVersions.get(executionId) ?? 0) + 1)
        if (next === entry.snapshots) next = { ...entry.snapshots }
        delete next[executionId]
      }
      this.#commitSnapshots(entry, next)
    }

    for (const [key, handle] of [...entry.readers]) {
      if (union.has(key)) continue
      handle.cancel()
      handle.unregister()
      entry.readers.delete(key)
    }

    for (const [key, item] of union) {
      if (entry.readers.has(key)) continue
      if (entry.settledKeys.has(key)) {
        // A finished key restarts only on fresh transport evidence: a new
        // turn's chunks queue in an open branch, while a stale consumer
        // report has none — restarting on the latter would orphan a zombie
        // reader on a stream that already ended (A7).
        if (!entry.sub.hasOpenBranch(item.executionId, item.anchorMessageId, item.attemptId)) continue
        entry.settledKeys.delete(key)
      }
      this.#startReader(
        entry,
        key,
        item.executionId,
        item.attemptId,
        item.anchorMessageId,
        item.seedFromEmpty,
        item.seed.getSeedMessages
      )
    }
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

  onFinish(topicId: string, listener: FinishListener): () => void {
    const entry = this.#entries.get(topicId)
    if (!entry) return () => {}
    entry.finishListeners.add(listener)
    return () => entry.finishListeners.delete(listener)
  }

  /** Drop one overlay/snapshot entry by its message id (post-persist handoff).
   *  Skipped when the execution has a live reader: `#startReader` already
   *  replaced the old snapshot, so the state now belongs to the newer turn and
   *  a delayed handoff for the finished one must not invalidate it. */
  disposeOverlay(topicId: string, messageId: string): void {
    const entry = this.#entries.get(topicId)
    if (!entry) return
    const snapshotEntry = Object.entries(entry.snapshots).find(([, snapshot]) => snapshot.id === messageId)
    const pendingEntry = [...entry.pendingSnapshots].find(([, item]) => item.snapshot.id === messageId)
    const executionId = snapshotEntry?.[0] ?? pendingEntry?.[0]
    if (!executionId || this.#liveReaderExecutionIds(entry).has(executionId)) return
    entry.pendingSnapshots.delete(executionId)
    entry.readerVersions.set(executionId, (entry.readerVersions.get(executionId) ?? 0) + 1)
    if (entry.pendingSnapshots.size === 0) this.#cancelFrame(entry)
    if (snapshotEntry) {
      const next = { ...entry.snapshots }
      delete next[snapshotEntry[0]]
      this.#commitSnapshots(entry, next)
    }
  }

  /** Drop settled overlay/snapshot entries for a routing scope (terminal handoff).
   *  Executions with a live reader are left untouched: a delayed handoff for a
   *  finished turn must not freeze a newer turn already streaming on this topic. */
  reset(topicId: string): void {
    const entry = this.#entries.get(topicId)
    if (!entry) return
    const liveExecutionIds = this.#liveReaderExecutionIds(entry)
    if (liveExecutionIds.size === 0) {
      this.clear(topicId)
      return
    }
    let next = entry.snapshots
    for (const executionId of new Set([...Object.keys(entry.snapshots), ...entry.pendingSnapshots.keys()])) {
      if (liveExecutionIds.has(executionId)) continue
      entry.pendingSnapshots.delete(executionId)
      entry.readerVersions.set(executionId, (entry.readerVersions.get(executionId) ?? 0) + 1)
      if (executionId in next) {
        if (next === entry.snapshots) next = { ...entry.snapshots }
        delete next[executionId]
      }
    }
    if (entry.pendingSnapshots.size === 0) this.#cancelFrame(entry)
    this.#commitSnapshots(entry, next)
  }

  /** Destructively drop every overlay/snapshot entry, including live readers'
   *  future frames (quick-assistant clear()). Not for terminal handoff. */
  clear(topicId: string): void {
    const entry = this.#entries.get(topicId)
    if (!entry) return
    this.#invalidatePending(entry)
    entry.readerVersions.clear()
    if (Object.keys(entry.snapshots).length > 0) this.#commitSnapshots(entry, {})
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
      snapshots: {},
      view: EMPTY_VIEW,
      pendingSnapshots: new Map(),
      readerVersions: new Map(),
      readers: new Map(),
      settledKeys: new Set(),
      liveReaderCount: 0,
      epoch: 0,
      frameId: null,
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

  #liveReaderExecutionIds(entry: Entry): Set<string> {
    const ids = new Set<string>()
    for (const handle of entry.readers.values()) ids.add(handle.executionId as string)
    return ids
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
    key: string,
    executionId: UniqueModelId,
    attemptId: string | undefined,
    anchorMessageId: string | undefined,
    seedFromEmpty: boolean | undefined,
    getSeedMessages: () => CherryUIMessage[]
  ): void {
    const branch = entry.sub.register(executionId, anchorMessageId, attemptId)
    const readerEpoch = entry.epoch
    const readerVersion = (entry.readerVersions.get(executionId) ?? 0) + 1
    entry.readerVersions.set(executionId, readerVersion)
    entry.pendingSnapshots.delete(executionId)
    // Readers use execution+anchor keys; snapshots stay executionId-keyed on
    // the PRECONDITION that at most one anchor is live per execution at a time
    // (steer continuation hands anchors off sequentially, never in parallel).
    // New turn for this execution: clear any retained prior snapshot.
    if (executionId in entry.snapshots) {
      const next = { ...entry.snapshots }
      delete next[executionId]
      this.#commitSnapshots(entry, next)
    }

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
      },
      unregister: () => {
        offTerminal()
        entry.sub.unregister(executionId, anchorMessageId, attemptId)
      }
    }
    entry.readers.set(key, handle)

    entry.liveReaderCount += 1
    void (async () => {
      let last: CherryUIMessage | undefined
      try {
        for await (const snapshot of readUIMessageStream<CherryUIMessage>({
          stream: branch,
          message: seed,
          terminateOnError: false,
          onError: (err) => logger.warn('readUIMessageStream error', { topicId, executionId, err })
        })) {
          if (cancelled) break
          const sharedParts = shareSettledPartReferences(
            last?.parts as CherryMessagePart[] | undefined,
            snapshot.parts as CherryMessagePart[]
          )
          const nextSnapshot = sharedParts === snapshot.parts ? snapshot : { ...snapshot, parts: sharedParts }
          last = nextSnapshot
          this.#queueSnapshot(entry, executionId, nextSnapshot, readerEpoch, readerVersion)
        }
      } catch (err) {
        // A crashed reader must not be reported as a clean success: transport
        // terminals never reach it, so isError has to come from here.
        readerFailed = true
        logger.error('execution reader threw', { topicId, executionId, err })
      } finally {
        offTerminal()
        if (entry.readers.get(key) === handle) {
          entry.sub.unregister(executionId, anchorMessageId, attemptId)
          entry.readers.delete(key)
        }
        if (!cancelled) {
          // Tombstone the finished key: a consumer remounting with a stale
          // execution set must not restart it. Only fresh transport evidence
          // (an open branch holding a new turn's chunks) may override — see
          // the start loop in syncExecutions.
          entry.settledKeys.add(key)
          if (entry.refCount === 0) {
            // Natural end in the background: the persisted DB row is the
            // authority and the next mount rebuilds from it — this
            // execution's overlay is not worth carrying.
            entry.pendingSnapshots.delete(executionId)
            entry.readerVersions.set(executionId, (entry.readerVersions.get(executionId) ?? 0) + 1)
            if (executionId in entry.snapshots) {
              const next = { ...entry.snapshots }
              delete next[executionId]
              this.#commitSnapshots(entry, next)
            }
          } else {
            // Terminal frames must be visible before the overlay handoff. This
            // and the acquire()-time stall flush are the intentional commits
            // outside the animation-frame cadence.
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
    executionId: string,
    snapshot: CherryUIMessage,
    epoch: number,
    readerVersion: number
  ): void {
    if (epoch !== entry.epoch || entry.readerVersions.get(executionId) !== readerVersion) return

    entry.pendingSnapshots.set(executionId, { epoch, readerVersion, snapshot })
    if (entry.frameId !== null) return

    entry.frameId = window.requestAnimationFrame(() => {
      entry.frameId = null
      this.#flushPending(entry, epoch)
    })
  }

  #flushPending(entry: Entry, expectedEpoch: number): void {
    if (expectedEpoch !== entry.epoch) return

    this.#cancelFrame(entry)
    const pending = entry.pendingSnapshots
    if (pending.size === 0) return
    entry.pendingSnapshots = new Map()

    let next = entry.snapshots
    for (const [executionId, item] of pending) {
      if (item.epoch !== entry.epoch) continue
      if (entry.readerVersions.get(executionId) !== item.readerVersion) continue
      if (entry.snapshots[executionId] === item.snapshot) continue
      if (next === entry.snapshots) next = { ...entry.snapshots }
      next[executionId] = item.snapshot
    }
    this.#commitSnapshots(entry, next)
  }

  #commitSnapshots(entry: Entry, next: Record<string, CherryUIMessage>): void {
    if (next === entry.snapshots) return
    entry.snapshots = next
    entry.view = computeView(next)
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
    if (entry.frameId === null) return
    window.cancelAnimationFrame(entry.frameId)
    entry.frameId = null
  }
}

export const executionStreamOverlayService = new ExecutionStreamOverlayService()
