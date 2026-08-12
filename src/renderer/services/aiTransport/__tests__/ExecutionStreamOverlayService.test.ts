import type { ActiveExecution } from '@shared/ai/transport'
import type { CherryUIMessage, CherryUIMessageChunk } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── Per-topic controllable fake TopicStreamSubscription ─────────────────
const mocks = vi.hoisted(() => {
  type TerminalCb = (
    id: string,
    t: { attemptId?: number; anchorMessageId?: string; isAbort: boolean; isError: boolean }
  ) => void
  type RetirementCb = (
    branches: ReadonlyArray<{ executionId: string; attemptId: number; anchorMessageId?: string }>
  ) => void
  type Branch = {
    executionId: string
    attemptId?: number
    anchorMessageId?: string
    stream: ReadableStream<unknown>
    controller: ReadableStreamDefaultController<unknown>
    closed: boolean
  }

  class FakeSubscription {
    readonly branches = new Map<string, Branch>()
    readonly terminalByKey = new Map<string, { executionId: string; terminal: Parameters<TerminalCb>[1] }>()
    readonly terminalCbs = new Set<TerminalCb>()
    readonly retirementCbs = new Set<RetirementCb>()
    readonly topicStateCbs = new Set<() => void>()
    readonly cancelledBranchKeys: string[] = []
    listenCalls = 0
    disposed = false
    topicOpen = false
    terminalAttemptWatermark: number | undefined

    constructor(readonly topicId: string) {
      subs.set(topicId, this)
    }

    #key(executionId: string, anchorMessageId?: string, attemptId?: number) {
      return JSON.stringify([executionId, anchorMessageId ?? null, attemptId ?? null])
    }

    #terminalFor(executionId: string, anchorMessageId?: string, attemptId?: number) {
      const exact = this.terminalByKey.get(this.#key(executionId, anchorMessageId, attemptId))
      if (exact) return exact
      if (attemptId) return undefined
      if (anchorMessageId) return this.terminalByKey.get(this.#key(executionId))
      return undefined
    }

    listen() {
      this.listenCalls += 1
    }

    #getOrCreate(executionId: string, anchorMessageId?: string, attemptId?: number) {
      const key = this.#key(executionId, anchorMessageId, attemptId)
      let branch = this.branches.get(key)
      if (!branch) {
        let controller!: ReadableStreamDefaultController<unknown>
        const stream = new ReadableStream<unknown>({ start: (c) => (controller = c) })
        branch = { executionId, attemptId, anchorMessageId, stream, controller, closed: false }
        if (
          this.#terminalFor(executionId, anchorMessageId, attemptId) ||
          (attemptId !== undefined &&
            this.terminalAttemptWatermark !== undefined &&
            attemptId <= this.terminalAttemptWatermark)
        ) {
          branch.closed = true
          controller.close()
          return branch
        }
        this.branches.set(key, branch)
      }
      return branch
    }

    register(executionId: string, anchorMessageId?: string, attemptId?: number) {
      return this.#getOrCreate(executionId, anchorMessageId, attemptId).stream
    }

    hasOpenBranch(executionId: string, anchorMessageId?: string, attemptId?: number) {
      const branch = this.branches.get(this.#key(executionId, anchorMessageId, attemptId))
      return branch !== undefined && !branch.closed
    }

    hasAnyOpenBranch() {
      for (const branch of this.branches.values()) {
        if (!branch.closed) return true
      }
      return false
    }

    isTopicOpen() {
      return this.topicOpen
    }

    #find(executionId: string, anchorMessageId?: string, attemptId?: number) {
      return this.branches.get(this.#key(executionId, anchorMessageId, attemptId))
    }

    unregister(executionId: string, anchorMessageId?: string, attemptId?: number) {
      const key = this.#key(executionId, anchorMessageId, attemptId)
      const branch = this.branches.get(key)
      if (branch) {
        branch.closed = true
        try {
          branch.controller.close()
        } catch {
          /* already closed */
        }
      }
      this.branches.delete(key)
      this.terminalByKey.delete(key)
    }

    cancelBranch(executionId: string, anchorMessageId?: string, attemptId?: number) {
      const key = this.#key(executionId, anchorMessageId, attemptId)
      this.cancelledBranchKeys.push(key)
      const branch = this.branches.get(key)
      if (!branch || branch.closed) return
      branch.closed = true
      branch.controller.error()
    }

    onExecutionTerminal(cb: TerminalCb) {
      this.terminalCbs.add(cb)
      for (const { executionId, terminal } of this.terminalByKey.values()) cb(executionId, terminal)
      return () => this.terminalCbs.delete(cb)
    }

    onBranchesRetired(cb: RetirementCb) {
      this.retirementCbs.add(cb)
      return () => this.retirementCbs.delete(cb)
    }

    onTopicStateChange(cb: () => void) {
      this.topicStateCbs.add(cb)
      return () => this.topicStateCbs.delete(cb)
    }

    dispose() {
      this.disposed = true
      for (const branch of this.branches.values()) {
        branch.closed = true
        try {
          branch.controller.close()
        } catch {
          /* already closed */
        }
      }
      this.branches.clear()
      this.terminalByKey.clear()
      this.terminalCbs.clear()
      this.retirementCbs.clear()
      this.topicStateCbs.clear()
    }

    // test helpers
    emit(
      executionId: string,
      chunk: CherryUIMessageChunk,
      anchorMessageId?: string,
      attemptId = anchorMessageId === undefined ? undefined : 1
    ) {
      // Mirror production #routeChunk: a chunk with no branch auto-creates
      // one under the exact key and queues there until a reader registers.
      if (this.disposed) return
      const branch =
        this.#find(executionId, anchorMessageId, attemptId) ??
        this.#getOrCreate(executionId, anchorMessageId, attemptId)
      if (!branch.closed) branch.controller.enqueue(chunk)
    }

    terminal(
      executionId: string,
      t: { isAbort: boolean; isError: boolean; isTopicDone?: boolean },
      anchorMessageId?: string,
      attemptId = anchorMessageId === undefined ? undefined : 1
    ) {
      const topicOpen = t.isTopicDone === false
      if (t.isTopicDone !== undefined && this.topicOpen !== topicOpen) {
        this.topicOpen = topicOpen
        for (const cb of [...this.topicStateCbs]) cb()
      }
      // Mirror production #emitTerminal: an unlabelled topic-level terminal fans out to every
      // registered branch for that execution and resolves each branch's anchor/attempt identity.
      const keys =
        anchorMessageId !== undefined || attemptId !== undefined
          ? [this.#key(executionId, anchorMessageId, attemptId)]
          : [...this.branches].filter(([, branch]) => branch.executionId === executionId).map(([key]) => key)
      if (keys.length === 0) keys.push(this.#key(executionId, undefined, attemptId))

      for (const key of keys) {
        const branch = this.branches.get(key)
        if (branch) {
          branch.closed = true
          try {
            branch.controller.close()
          } catch {
            /* already closed */
          }
        }
        const terminal = {
          isAbort: t.isAbort,
          isError: t.isError,
          anchorMessageId: anchorMessageId ?? branch?.anchorMessageId,
          attemptId: attemptId ?? branch?.attemptId
        }
        this.terminalByKey.set(key, { executionId, terminal })
        for (const cb of [...this.terminalCbs]) cb(executionId, terminal)
      }
    }

    retire(branches: ReadonlyArray<{ executionId: string; attemptId: number; anchorMessageId?: string }>) {
      for (const { attemptId } of branches) {
        this.terminalAttemptWatermark = Math.max(this.terminalAttemptWatermark ?? 0, attemptId)
      }
      for (const cb of [...this.retirementCbs]) cb(branches)
      for (const { executionId, attemptId, anchorMessageId } of branches) {
        this.unregister(executionId, anchorMessageId, attemptId)
      }
    }
  }

  const subs = new Map<string, FakeSubscription>()
  return { subs, FakeSubscription }
})

vi.mock('../TopicStreamSubscription', () => ({
  TopicStreamSubscription: mocks.FakeSubscription
}))

import { ExecutionStreamOverlayService } from '../ExecutionStreamOverlayService'

const A = 'openai::gpt-4o' as UniqueModelId

const exec = (
  executionId: UniqueModelId,
  anchorMessageId?: string,
  attemptId = 1,
  seedFromEmpty?: boolean
): ActiveExecution => ({
  executionId,
  anchorMessageId,
  attemptId,
  seedFromEmpty
})
const asst = (id: string, parts: CherryUIMessage['parts'] = []): CherryUIMessage =>
  ({ id, role: 'assistant', parts }) as CherryUIMessage

function streamText(
  sub: InstanceType<typeof mocks.FakeSubscription>,
  executionId: string,
  textId: string,
  text: string,
  anchorMessageId = 'anchor-a',
  attemptId = 1
) {
  sub.emit(executionId, { type: 'text-start', id: textId } as CherryUIMessageChunk, anchorMessageId, attemptId)
  sub.emit(
    executionId,
    { type: 'text-delta', id: textId, delta: text } as CherryUIMessageChunk,
    anchorMessageId,
    attemptId
  )
  sub.emit(executionId, { type: 'text-end', id: textId } as CherryUIMessageChunk, anchorMessageId, attemptId)
}

function textOf(parts: CherryUIMessage['parts'] | undefined): string {
  return (parts ?? [])
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('')
}

// Reader loops need macrotask turns to drain queued chunks + close; commit
// timers are left untouched so flush behavior stays observable via nextCommit().
async function drainStreamMicrotasks(): Promise<void> {
  for (let round = 0; round < 3; round++) {
    for (let index = 0; index < 24; index++) {
      await Promise.resolve()
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
}

// Waits past the MIN_COMMIT_INTERVAL_MS floor so the pending snapshot commit fires.
async function nextCommit(): Promise<void> {
  await drainStreamMicrotasks()
  await new Promise<void>((resolve) => setTimeout(resolve, 110))
}

const TOPIC = 'topic-1'
const seedRows = [asst('anchor-a')]
const getSeed = () => seedRows

beforeEach(() => mocks.subs.clear())
afterEach(() => {
  vi.useRealTimers()
  mocks.subs.clear()
  vi.restoreAllMocks()
})

describe('ExecutionStreamOverlayService', () => {
  it('starts an in-place retry from empty parts even when cached history still has the old failure', async () => {
    const service = new ExecutionStreamOverlayService()
    const consumer = {}
    const staleSeed = () =>
      [
        asst('anchor-a', [
          { type: 'text', text: 'old partial response' },
          { type: 'data-error', data: { message: 'old failure' } }
        ])
      ] as CherryUIMessage[]

    service.acquire(TOPIC)
    service.syncExecutions(TOPIC, consumer, [exec(A, 'anchor-a', 2, true)], staleSeed)
    const sub = mocks.subs.get(TOPIC)!

    sub.emit(A, { type: 'text-start', id: 'retry-text' } as CherryUIMessageChunk, 'anchor-a', 2)
    sub.emit(A, { type: 'text-delta', id: 'retry-text', delta: 'new response' } as CherryUIMessageChunk, 'anchor-a', 2)
    await nextCommit()

    const parts = service.getView(TOPIC).overlay['anchor-a']
    expect(textOf(parts)).toBe('new response')
    expect(parts?.some((part) => part.type === 'data-error')).toBe(false)
  })

  it('keeps the reader running and the view updating across release, restores synchronously on re-acquire', async () => {
    const service = new ExecutionStreamOverlayService()
    const consumer = {}
    service.acquire(TOPIC)
    service.syncExecutions(TOPIC, consumer, [exec(A, 'anchor-a')], getSeed)
    const sub = mocks.subs.get(TOPIC)!

    streamText(sub, A, 't1', 'before-release')
    await nextCommit()
    expect(textOf(service.getView(TOPIC).overlay['anchor-a'])).toBe('before-release')

    service.release(TOPIC, consumer)

    // No consumer mounted: the reader must survive and keep assembling.
    sub.emit(A, { type: 'text-start', id: 't2' } as CherryUIMessageChunk, 'anchor-a')
    sub.emit(A, { type: 'text-delta', id: 't2', delta: ' after-release' } as CherryUIMessageChunk, 'anchor-a')
    await nextCommit()
    expect(textOf(service.getView(TOPIC).overlay['anchor-a'])).toBe('before-release after-release')
    expect(sub.disposed).toBe(false)

    // Re-acquire reads the retained view synchronously — no attach/replay wait.
    service.acquire(TOPIC)
    expect(textOf(service.getView(TOPIC).overlay['anchor-a'])).toBe('before-release after-release')
  })

  it('drops the entry (and detaches) when the last reader ends at refCount 0', async () => {
    const service = new ExecutionStreamOverlayService()
    const consumer = {}
    service.acquire(TOPIC)
    service.syncExecutions(TOPIC, consumer, [exec(A, 'anchor-a')], getSeed)
    const sub = mocks.subs.get(TOPIC)!

    streamText(sub, A, 't1', 'text')
    await nextCommit()
    service.release(TOPIC, consumer)
    expect(sub.disposed).toBe(false)

    sub.terminal(A, { isAbort: false, isError: false }, 'anchor-a')
    await drainStreamMicrotasks()

    // The next mount rebuilds from DB + shared cache, exactly like today's remount.
    expect(sub.disposed).toBe(true)
    expect(service.getView(TOPIC).overlay).toEqual({})
  })

  it('does NOT self-clean on terminal while a consumer is mounted — the status-edge handoff owns disposal', async () => {
    const service = new ExecutionStreamOverlayService()
    const consumer = {}
    service.acquire(TOPIC)
    service.syncExecutions(TOPIC, consumer, [exec(A, 'anchor-a')], getSeed)
    const sub = mocks.subs.get(TOPIC)!

    streamText(sub, A, 't1', 'final')
    sub.terminal(A, { isAbort: false, isError: false }, 'anchor-a')
    await drainStreamMicrotasks()

    // Terminal frame retained for the mounted consumer until refresh() lands.
    expect(sub.disposed).toBe(false)
    expect(textOf(service.getView(TOPIC).overlay['anchor-a'])).toBe('final')

    // Publishing the terminal frame can rerender a mounted consumer before
    // shared status removes the execution. That same desired key must not
    // restart a reader and clear the retained final frame.
    service.syncExecutions(TOPIC, consumer, [exec(A, 'anchor-a')], getSeed)
    expect(sub.branches.size).toBe(0)
    expect(textOf(service.getView(TOPIC).overlay['anchor-a'])).toBe('final')

    service.reset(TOPIC)
    expect(service.getView(TOPIC).overlay).toEqual({})

    service.release(TOPIC, consumer)
    expect(sub.disposed).toBe(true)
  })

  it('retires watermark-covered sibling readers without reporting an implicit success', async () => {
    const B = 'anthropic::claude' as UniqueModelId
    const service = new ExecutionStreamOverlayService()
    const consumer = {}
    const seed = () => [asst('anchor-a'), asst('anchor-b')]
    const onFinish = vi.fn()
    service.acquire(TOPIC)
    service.onFinish(TOPIC, onFinish)
    service.syncExecutions(TOPIC, consumer, [exec(A, 'anchor-a', 1), exec(B, 'anchor-b', 2)], seed)
    const sub = mocks.subs.get(TOPIC)!

    streamText(sub, A, 't1', 'failed partial', 'anchor-a', 1)
    streamText(sub, B, 't2', 'final answer', 'anchor-b', 2)
    sub.retire([{ executionId: A, attemptId: 1, anchorMessageId: 'anchor-a' }])
    sub.terminal(B, { isAbort: false, isError: false }, 'anchor-b', 2)
    await drainStreamMicrotasks()

    expect(onFinish).toHaveBeenCalledTimes(1)
    expect(onFinish).toHaveBeenCalledWith(B, expect.objectContaining({ attemptId: 2, isError: false }))
    expect(sub.cancelledBranchKeys).toEqual([JSON.stringify([A, 'anchor-a', 1])])

    service.syncExecutions(TOPIC, consumer, [], seed)
    service.syncExecutions(TOPIC, consumer, [exec(A, 'anchor-a', 1), exec(B, 'anchor-b', 2)], seed)
    expect(sub.branches.has(JSON.stringify([A, 'anchor-a', 1]))).toBe(false)
    expect(onFinish).toHaveBeenCalledTimes(1)
  })

  it('remount with a stale active set does not restart a settled execution or wipe its final frame', async () => {
    const B = 'anthropic::claude' as UniqueModelId
    const service = new ExecutionStreamOverlayService()
    const consumer = {}
    const seed = () => [asst('anchor-a'), asst('anchor-b')]
    service.acquire(TOPIC)
    service.syncExecutions(TOPIC, consumer, [exec(A, 'anchor-a'), exec(B, 'anchor-b')], seed)
    const sub = mocks.subs.get(TOPIC)!

    // A finishes; B keeps streaming so the entry survives the release below.
    streamText(sub, A, 't1', 'final')
    sub.terminal(A, { isAbort: false, isError: false }, 'anchor-a')
    sub.emit(B, { type: 'text-start', id: 't2' } as CherryUIMessageChunk, 'anchor-b')
    sub.emit(B, { type: 'text-delta', id: 't2', delta: 'live' } as CherryUIMessageChunk, 'anchor-b')
    await nextCommit()
    expect(textOf(service.getView(TOPIC).overlay['anchor-a'])).toBe('final')

    service.release(TOPIC, consumer)

    // Remount while shared status is momentarily stale and still lists A.
    const consumer2 = {}
    service.acquire(TOPIC)
    service.syncExecutions(TOPIC, consumer2, [exec(A, 'anchor-a'), exec(B, 'anchor-b')], seed)
    await drainStreamMicrotasks()

    // A stays settled: no reader restart, retained final frame intact.
    expect(sub.branches.has(JSON.stringify([A, 'anchor-a', 1]))).toBe(false)
    expect(textOf(service.getView(TOPIC).overlay['anchor-a'])).toBe('final')
    expect(textOf(service.getView(TOPIC).overlay['anchor-b'])).toBe('live')
  })

  it('reset drops only settled snapshots — a newer turn already streaming keeps its reader publishing', async () => {
    const B = 'anthropic::claude' as UniqueModelId
    const service = new ExecutionStreamOverlayService()
    const consumer = {}
    const seed = () => [asst('anchor-a'), asst('anchor-b')]
    service.acquire(TOPIC)
    service.syncExecutions(TOPIC, consumer, [exec(A, 'anchor-a'), exec(B, 'anchor-b')], seed)
    const sub = mocks.subs.get(TOPIC)!

    // Turn A finishes (reader settled, snapshot retained); turn B keeps streaming.
    streamText(sub, A, 't1', 'finished')
    sub.terminal(A, { isAbort: false, isError: false }, 'anchor-a')
    sub.emit(B, { type: 'text-start', id: 't2' } as CherryUIMessageChunk, 'anchor-b')
    sub.emit(B, { type: 'text-delta', id: 't2', delta: 'live' } as CherryUIMessageChunk, 'anchor-b')
    await nextCommit()
    expect(textOf(service.getView(TOPIC).overlay['anchor-a'])).toBe('finished')
    expect(textOf(service.getView(TOPIC).overlay['anchor-b'])).toBe('live')

    // The delayed DB handoff for turn A must not invalidate turn B.
    service.reset(TOPIC)
    expect(service.getView(TOPIC).overlay['anchor-a']).toBeUndefined()
    expect(textOf(service.getView(TOPIC).overlay['anchor-b'])).toBe('live')

    sub.emit(B, { type: 'text-delta', id: 't2', delta: '-more' } as CherryUIMessageChunk, 'anchor-b')
    await nextCommit()
    expect(textOf(service.getView(TOPIC).overlay['anchor-b'])).toBe('live-more')
  })

  it('clear destructively drops everything, including a live reader’s future frames', async () => {
    const service = new ExecutionStreamOverlayService()
    const consumer = {}
    service.acquire(TOPIC)
    service.syncExecutions(TOPIC, consumer, [exec(A, 'anchor-a')], getSeed)
    const sub = mocks.subs.get(TOPIC)!

    sub.emit(A, { type: 'text-start', id: 't1' } as CherryUIMessageChunk, 'anchor-a')
    sub.emit(A, { type: 'text-delta', id: 't1', delta: 'live' } as CherryUIMessageChunk, 'anchor-a')
    await nextCommit()
    expect(textOf(service.getView(TOPIC).overlay['anchor-a'])).toBe('live')

    service.clear(TOPIC)
    expect(service.getView(TOPIC).overlay).toEqual({})

    // Frames from the (stopped) stream after clear must stay dropped.
    sub.emit(A, { type: 'text-delta', id: 't1', delta: '-stale' } as CherryUIMessageChunk, 'anchor-a')
    await nextCommit()
    expect(service.getView(TOPIC).overlay).toEqual({})
  })

  it('reconciles on remount: drops snapshots of no-longer-active executions, keeps streaming ones', async () => {
    const B = 'anthropic::claude' as UniqueModelId
    const service = new ExecutionStreamOverlayService()
    const consumer = {}
    const seed = () => [asst('anchor-a'), asst('anchor-b')]
    service.acquire(TOPIC)
    service.syncExecutions(TOPIC, consumer, [exec(A, 'anchor-a'), exec(B, 'anchor-b')], seed)
    const sub = mocks.subs.get(TOPIC)!

    streamText(sub, A, 't1', 'finished-while-away')
    sub.emit(B, { type: 'text-start', id: 't2' } as CherryUIMessageChunk, 'anchor-b')
    sub.emit(B, { type: 'text-delta', id: 't2', delta: 'still-live' } as CherryUIMessageChunk, 'anchor-b')
    await nextCommit()

    service.release(TOPIC, consumer)
    // A terminates while no consumer is mounted — the status edge that would
    // hand its frame off to the DB row fires unobserved, so the frame is
    // dropped immediately: the persisted DB row owns it.
    sub.terminal(A, { isAbort: false, isError: false }, 'anchor-a')
    await drainStreamMicrotasks()
    expect(service.getView(TOPIC).overlay['anchor-a']).toBeUndefined()

    service.acquire(TOPIC)
    service.syncExecutions(TOPIC, consumer, [exec(B, 'anchor-b')], seed)

    // B streams on across the remount.
    expect(service.getView(TOPIC).overlay['anchor-a']).toBeUndefined()
    expect(textOf(service.getView(TOPIC).overlay['anchor-b'])).toBe('still-live')
  })

  it('A7: does not restart an execution that finished in the background when a stale set is re-reported', async () => {
    const B = 'anthropic::claude' as UniqueModelId
    const service = new ExecutionStreamOverlayService()
    const consumer = {}
    const seed = () => [asst('anchor-a'), asst('anchor-b')]
    service.acquire(TOPIC)
    service.syncExecutions(TOPIC, consumer, [exec(A, 'anchor-a'), exec(B, 'anchor-b')], seed)
    const sub = mocks.subs.get(TOPIC)!

    streamText(sub, A, 't1', 'first')
    sub.emit(B, { type: 'text-start', id: 't2' } as CherryUIMessageChunk, 'anchor-b')
    sub.emit(B, { type: 'text-delta', id: 't2', delta: 'live' } as CherryUIMessageChunk, 'anchor-b')
    await nextCommit()
    service.release(TOPIC, consumer)

    sub.terminal(A, { isAbort: false, isError: false }, 'anchor-a')
    await drainStreamMicrotasks()

    // Natural end in the background: A's overlay is dropped outright — the
    // persisted DB row owns it and the next mount rebuilds from there.
    expect(service.getView(TOPIC).overlay['anchor-a']).toBeUndefined()
    expect(sub.disposed).toBe(false)

    // Remount with the stale Activity-preserved set that still lists A.
    service.acquire(TOPIC)
    service.syncExecutions(TOPIC, consumer, [exec(A, 'anchor-a'), exec(B, 'anchor-b')], seed)
    await drainStreamMicrotasks()

    // Tombstoned: no zombie reader, no new branch for A; B is untouched.
    expect(sub.branches.has(JSON.stringify([A, 'anchor-a', 1]))).toBe(false)
    expect(sub.branches.size).toBe(1)
    sub.emit(B, { type: 'text-delta', id: 't2', delta: '-more' } as CherryUIMessageChunk, 'anchor-b')
    await nextCommit()
    expect(textOf(service.getView(TOPIC).overlay['anchor-b'])).toBe('live-more')
  })

  it('hidden steer continuation: keeps the entry attached while the next round’s chunks queue unclaimed', async () => {
    const service = new ExecutionStreamOverlayService()
    const consumer = {}
    const seed = () => [asst('anchor-a'), asst('anchor-b')]
    service.acquire(TOPIC)
    service.syncExecutions(TOPIC, consumer, [exec(A, 'anchor-a')], seed)
    const sub = mocks.subs.get(TOPIC)!

    streamText(sub, A, 't1', 'first')
    await nextCommit()
    service.release(TOPIC, consumer)

    // Production order: Main broadcasts A done(false), waits for listeners,
    // and only then schedules B. The empty inter-turn gap must stay attached.
    sub.terminal(A, { isAbort: false, isError: false, isTopicDone: false }, 'anchor-a')
    await drainStreamMicrotasks()
    expect(sub.disposed).toBe(false)

    sub.emit(A, { type: 'text-start', id: 't2' } as CherryUIMessageChunk, 'anchor-b')
    sub.emit(A, { type: 'text-delta', id: 't2', delta: 'second' } as CherryUIMessageChunk, 'anchor-b')

    // The unclaimed continuation then pins the same retained entry.
    expect(sub.disposed).toBe(false)

    service.acquire(TOPIC)
    service.syncExecutions(TOPIC, consumer, [exec(A, 'anchor-b')], seed)
    await nextCommit()
    expect(textOf(service.getView(TOPIC).overlay['anchor-b'])).toBe('second')
  })

  it('hidden steer continuation: drops the pinned entry once its queued round terminates unobserved', async () => {
    const service = new ExecutionStreamOverlayService()
    const consumer = {}
    const seed = () => [asst('anchor-a'), asst('anchor-b')]
    service.acquire(TOPIC)
    service.syncExecutions(TOPIC, consumer, [exec(A, 'anchor-a')], seed)
    const sub = mocks.subs.get(TOPIC)!

    streamText(sub, A, 't1', 'first')
    await nextCommit()
    service.release(TOPIC, consumer)

    sub.terminal(A, { isAbort: false, isError: false, isTopicDone: false }, 'anchor-a')
    await drainStreamMicrotasks()
    expect(sub.disposed).toBe(false)

    sub.emit(A, { type: 'text-start', id: 't2' } as CherryUIMessageChunk, 'anchor-b')
    // The user never returns; round B ends and closes the queued branch.
    sub.terminal(A, { isAbort: false, isError: false, isTopicDone: true }, 'anchor-b')
    await drainStreamMicrotasks()
    expect(sub.disposed).toBe(true)
  })

  it('restarts a finished execution only when a new turn’s chunks are already queued in the transport', async () => {
    const B = 'anthropic::claude' as UniqueModelId
    const service = new ExecutionStreamOverlayService()
    const consumer = {}
    const seed = () => [asst('anchor-a'), asst('anchor-b')]
    service.acquire(TOPIC)
    service.syncExecutions(TOPIC, consumer, [exec(A, 'anchor-a'), exec(B, 'anchor-b')], seed)
    const sub = mocks.subs.get(TOPIC)!

    streamText(sub, A, 't1', 'first')
    await nextCommit()
    service.release(TOPIC, consumer)

    sub.terminal(A, { isAbort: false, isError: false }, 'anchor-a')
    await drainStreamMicrotasks()

    // A new turn on the same key starts while hidden: the transport
    // auto-creates an open branch and queues its chunks.
    sub.emit(A, { type: 'text-start', id: 't2' } as CherryUIMessageChunk, 'anchor-a')
    sub.emit(A, { type: 'text-delta', id: 't2', delta: 'second' } as CherryUIMessageChunk, 'anchor-a')

    service.acquire(TOPIC)
    service.syncExecutions(TOPIC, consumer, [exec(A, 'anchor-a'), exec(B, 'anchor-b')], seed)
    await nextCommit()

    // Fresh transport evidence overrides the tombstone and replays the queue.
    expect(textOf(service.getView(TOPIC).overlay['anchor-a'])).toBe('second')
  })

  it('notifies every mounted consumer exactly once per execution finish', async () => {
    const service = new ExecutionStreamOverlayService()
    const consumer1 = {}
    const consumer2 = {}
    service.acquire(TOPIC)
    service.acquire(TOPIC)
    const onFinish1 = vi.fn()
    const onFinish2 = vi.fn()
    service.onFinish(TOPIC, onFinish1)
    service.onFinish(TOPIC, onFinish2)
    service.syncExecutions(TOPIC, consumer1, [exec(A, 'anchor-a')], getSeed)
    // Second consumer contributes the same shared-cache execution set; the
    // reader must not be duplicated.
    service.syncExecutions(TOPIC, consumer2, [exec(A, 'anchor-a')], getSeed)
    const sub = mocks.subs.get(TOPIC)!
    expect(sub.branches.size).toBe(1)

    streamText(sub, A, 't1', 'x')
    sub.terminal(A, { isAbort: true, isError: false }, 'anchor-a')
    await drainStreamMicrotasks()

    expect(onFinish1).toHaveBeenCalledTimes(1)
    expect(onFinish2).toHaveBeenCalledTimes(1)
    expect(onFinish1.mock.calls[0][1].isAbort).toBe(true)
  })

  it('extends the shared commit deadline when a larger execution joins the pending batch', async () => {
    vi.useFakeTimers()
    const B = 'anthropic::claude' as UniqueModelId
    const service = new ExecutionStreamOverlayService()
    const consumer = {}
    const seed = () => [asst('anchor-a'), asst('anchor-b')]
    service.acquire(TOPIC)
    service.syncExecutions(TOPIC, consumer, [exec(A, 'anchor-a'), exec(B, 'anchor-b')], seed)
    const sub = mocks.subs.get(TOPIC)!
    const onChange = vi.fn()
    service.subscribe(TOPIC, onChange)

    streamText(sub, A, 'initial', 'initial')
    await vi.advanceTimersByTimeAsync(100)
    expect(textOf(service.getView(TOPIC).overlay['anchor-a'])).toBe('initial')
    onChange.mockClear()

    streamText(sub, A, 'small', 'small')
    await vi.advanceTimersByTimeAsync(0)
    streamText(sub, B, 'large', 'x'.repeat(600_000), 'anchor-b')
    await vi.advanceTimersByTimeAsync(0)

    await vi.advanceTimersByTimeAsync(100)
    expect(onChange).not.toHaveBeenCalled()
    expect(service.getView(TOPIC).overlay['anchor-b']).toBeUndefined()

    await vi.advanceTimersByTimeAsync(201)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(textOf(service.getView(TOPIC).overlay['anchor-b'])).toHaveLength(600_000)

    sub.emit(A, { type: 'text-start', id: 'terminal' } as CherryUIMessageChunk, 'anchor-a')
    sub.emit(A, { type: 'text-delta', id: 'terminal', delta: '-terminal' } as CherryUIMessageChunk, 'anchor-a')
    await vi.advanceTimersByTimeAsync(0)
    sub.terminal(A, { isAbort: false, isError: false }, 'anchor-a')
    await vi.advanceTimersByTimeAsync(0)

    expect(onChange).toHaveBeenCalledTimes(2)
    expect(textOf(service.getView(TOPIC).overlay['anchor-a'])).toBe('initialsmall-terminal')
  })

  it('flushes stalled pending snapshots on acquire (hidden-window timer stall)', async () => {
    const service = new ExecutionStreamOverlayService()
    const consumer = {}
    service.acquire(TOPIC)
    service.syncExecutions(TOPIC, consumer, [exec(A, 'anchor-a')], getSeed)
    const sub = mocks.subs.get(TOPIC)!

    // Two quick commits so lastCommitAt is fresh when the third snapshot queues,
    // pinning its commit timer behind the interval floor.
    streamText(sub, A, 't1', 'committed')
    await nextCommit()
    streamText(sub, A, 't2', '-flushed')
    await drainStreamMicrotasks()
    expect(textOf(service.getView(TOPIC).overlay['anchor-a'])).toBe('committed-flushed')

    streamText(sub, A, 't3', '-stalled')
    await drainStreamMicrotasks()
    // Commit timer still pending — the view is stale…
    expect(textOf(service.getView(TOPIC).overlay['anchor-a'])).toBe('committed-flushed')

    // …until a consumer re-acquires, which materializes pending frames.
    service.acquire(TOPIC)
    expect(textOf(service.getView(TOPIC).overlay['anchor-a'])).toBe('committed-flushed-stalled')
  })

  it('evicts the oldest refCount-0 entry past MAX_ENTRIES as a leak backstop', async () => {
    const service = new ExecutionStreamOverlayService()
    // 32 released-but-live entries (reader parked on an open stream — the
    // "terminal never arrived" leak shape the backstop exists for).
    for (let index = 0; index < 32; index++) {
      const topicId = `leak-${index}`
      const consumer = {}
      service.acquire(topicId)
      service.syncExecutions(topicId, consumer, [exec(A, 'anchor-a')], getSeed)
      service.release(topicId, consumer)
    }
    await drainStreamMicrotasks()
    expect(mocks.subs.get('leak-0')!.disposed).toBe(false)

    service.acquire('fresh-topic')

    expect(mocks.subs.get('leak-0')!.disposed).toBe(true)
    expect(mocks.subs.get('leak-1')!.disposed).toBe(false)
    expect(mocks.subs.get('fresh-topic')).toBeDefined()
  })

  it('does not let an evicted reader finalizer delete a replacement entry for the same topic', async () => {
    const service = new ExecutionStreamOverlayService()
    for (let index = 0; index < 32; index++) {
      const topicId = `leak-${index}`
      const consumer = {}
      service.acquire(topicId)
      service.syncExecutions(topicId, consumer, [exec(A, 'anchor-a')], getSeed)
      service.release(topicId, consumer)
    }

    service.acquire('fresh-topic')
    expect(mocks.subs.get('leak-0')!.disposed).toBe(true)

    const replacementConsumer = {}
    service.acquire('leak-0')
    const replacement = mocks.subs.get('leak-0')!
    await drainStreamMicrotasks()

    service.syncExecutions('leak-0', replacementConsumer, [exec(A, 'anchor-a')], getSeed)
    expect(replacement.disposed).toBe(false)
    expect(replacement.branches.size).toBe(1)
  })

  it('does not listen on an empty topicId (pending temp topic)', () => {
    const service = new ExecutionStreamOverlayService()
    service.acquire('')
    expect(mocks.subs.get('')!.listenCalls).toBe(0)
  })
})
