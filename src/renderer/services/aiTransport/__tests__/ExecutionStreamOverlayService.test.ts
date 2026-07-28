import type { ActiveExecution } from '@shared/ai/transport'
import type { CherryUIMessage, CherryUIMessageChunk } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── Per-topic controllable fake TopicStreamSubscription ─────────────────
const mocks = vi.hoisted(() => {
  type TerminalCb = (id: string, t: { anchorMessageId?: string; isAbort: boolean; isError: boolean }) => void
  type Branch = {
    executionId: string
    stream: ReadableStream<unknown>
    controller: ReadableStreamDefaultController<unknown>
  }

  class FakeSubscription {
    readonly branches = new Map<string, Branch>()
    readonly terminalCbs = new Set<TerminalCb>()
    listenCalls = 0
    disposed = false

    constructor(readonly topicId: string) {
      subs.set(topicId, this)
    }

    #key(executionId: string, anchorMessageId?: string) {
      return JSON.stringify([executionId, anchorMessageId ?? null])
    }

    listen() {
      this.listenCalls += 1
    }

    register(executionId: string, anchorMessageId?: string) {
      const key = this.#key(executionId, anchorMessageId)
      let branch = this.branches.get(key)
      if (!branch) {
        let controller!: ReadableStreamDefaultController<unknown>
        const stream = new ReadableStream<unknown>({ start: (c) => (controller = c) })
        branch = { executionId, stream, controller }
        this.branches.set(key, branch)
      }
      return branch.stream
    }

    #find(executionId: string, anchorMessageId?: string) {
      const exact = this.branches.get(this.#key(executionId, anchorMessageId))
      if (exact || anchorMessageId !== undefined) return exact
      return [...this.branches.values()].find((branch) => branch.executionId === executionId)
    }

    unregister(executionId: string, anchorMessageId?: string) {
      const key = this.#key(executionId, anchorMessageId)
      try {
        this.branches.get(key)?.controller.close()
      } catch {
        /* already closed */
      }
      this.branches.delete(key)
    }

    onExecutionTerminal(cb: TerminalCb) {
      this.terminalCbs.add(cb)
      return () => this.terminalCbs.delete(cb)
    }

    dispose() {
      this.disposed = true
      for (const branch of this.branches.values()) {
        try {
          branch.controller.close()
        } catch {
          /* already closed */
        }
      }
      this.branches.clear()
      this.terminalCbs.clear()
    }

    // test helpers
    emit(executionId: string, chunk: CherryUIMessageChunk, anchorMessageId?: string) {
      this.#find(executionId, anchorMessageId)?.controller.enqueue(chunk)
    }

    terminal(executionId: string, t: { isAbort: boolean; isError: boolean }, anchorMessageId?: string) {
      for (const cb of [...this.terminalCbs]) cb(executionId, { ...t, anchorMessageId })
      try {
        this.#find(executionId, anchorMessageId)?.controller.close()
      } catch {
        /* already closed */
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

const exec = (executionId: UniqueModelId, anchorMessageId?: string): ActiveExecution => ({
  executionId,
  anchorMessageId
})
const asst = (id: string, parts: CherryUIMessage['parts'] = []): CherryUIMessage =>
  ({ id, role: 'assistant', parts }) as CherryUIMessage

function streamText(
  sub: InstanceType<typeof mocks.FakeSubscription>,
  executionId: string,
  textId: string,
  text: string
) {
  sub.emit(executionId, { type: 'text-start', id: textId } as CherryUIMessageChunk)
  sub.emit(executionId, { type: 'text-delta', id: textId, delta: text } as CherryUIMessageChunk)
  sub.emit(executionId, { type: 'text-end', id: textId } as CherryUIMessageChunk)
}

function textOf(parts: CherryUIMessage['parts'] | undefined): string {
  return (parts ?? [])
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('')
}

// Reader loops need macrotask turns to drain queued chunks + close; rAF is
// left untouched so frame-flush behavior stays observable via nextFrame().
async function drainStreamMicrotasks(): Promise<void> {
  for (let round = 0; round < 3; round++) {
    for (let index = 0; index < 24; index++) {
      await Promise.resolve()
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
}

async function nextFrame(): Promise<void> {
  await drainStreamMicrotasks()
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
}

const TOPIC = 'topic-1'
const seedRows = [asst('anchor-a')]
const getSeed = () => seedRows

beforeEach(() => mocks.subs.clear())
afterEach(() => {
  mocks.subs.clear()
  vi.restoreAllMocks()
})

describe('ExecutionStreamOverlayService', () => {
  it('keeps the reader running and the view updating across release, restores synchronously on re-acquire', async () => {
    const service = new ExecutionStreamOverlayService()
    const consumer = {}
    service.acquire(TOPIC)
    service.syncExecutions(TOPIC, consumer, [exec(A, 'anchor-a')], getSeed)
    const sub = mocks.subs.get(TOPIC)!

    streamText(sub, A, 't1', 'before-release')
    await nextFrame()
    expect(textOf(service.getView(TOPIC).overlay['anchor-a'])).toBe('before-release')

    service.release(TOPIC, consumer)

    // No consumer mounted: the reader must survive and keep assembling.
    sub.emit(A, { type: 'text-start', id: 't2' } as CherryUIMessageChunk)
    sub.emit(A, { type: 'text-delta', id: 't2', delta: ' after-release' } as CherryUIMessageChunk)
    await nextFrame()
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
    await nextFrame()
    service.release(TOPIC, consumer)
    expect(sub.disposed).toBe(false)

    sub.terminal(A, { isAbort: false, isError: false })
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
    sub.terminal(A, { isAbort: false, isError: false })
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
    sub.terminal(A, { isAbort: false, isError: false })
    sub.emit(B, { type: 'text-start', id: 't2' } as CherryUIMessageChunk, 'anchor-b')
    sub.emit(B, { type: 'text-delta', id: 't2', delta: 'live' } as CherryUIMessageChunk, 'anchor-b')
    await nextFrame()
    expect(textOf(service.getView(TOPIC).overlay['anchor-a'])).toBe('final')

    service.release(TOPIC, consumer)

    // Remount while shared status is momentarily stale and still lists A.
    const consumer2 = {}
    service.acquire(TOPIC)
    service.syncExecutions(TOPIC, consumer2, [exec(A, 'anchor-a'), exec(B, 'anchor-b')], seed)
    await drainStreamMicrotasks()

    // A stays settled: no reader restart, retained final frame intact.
    expect(sub.branches.has(JSON.stringify([A, 'anchor-a']))).toBe(false)
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
    sub.terminal(A, { isAbort: false, isError: false })
    sub.emit(B, { type: 'text-start', id: 't2' } as CherryUIMessageChunk, 'anchor-b')
    sub.emit(B, { type: 'text-delta', id: 't2', delta: 'live' } as CherryUIMessageChunk, 'anchor-b')
    await nextFrame()
    expect(textOf(service.getView(TOPIC).overlay['anchor-a'])).toBe('finished')
    expect(textOf(service.getView(TOPIC).overlay['anchor-b'])).toBe('live')

    // The delayed DB handoff for turn A must not invalidate turn B.
    service.reset(TOPIC)
    expect(service.getView(TOPIC).overlay['anchor-a']).toBeUndefined()
    expect(textOf(service.getView(TOPIC).overlay['anchor-b'])).toBe('live')

    sub.emit(B, { type: 'text-delta', id: 't2', delta: '-more' } as CherryUIMessageChunk, 'anchor-b')
    await nextFrame()
    expect(textOf(service.getView(TOPIC).overlay['anchor-b'])).toBe('live-more')
  })

  it('clear destructively drops everything, including a live reader’s future frames', async () => {
    const service = new ExecutionStreamOverlayService()
    const consumer = {}
    service.acquire(TOPIC)
    service.syncExecutions(TOPIC, consumer, [exec(A, 'anchor-a')], getSeed)
    const sub = mocks.subs.get(TOPIC)!

    sub.emit(A, { type: 'text-start', id: 't1' } as CherryUIMessageChunk)
    sub.emit(A, { type: 'text-delta', id: 't1', delta: 'live' } as CherryUIMessageChunk)
    await nextFrame()
    expect(textOf(service.getView(TOPIC).overlay['anchor-a'])).toBe('live')

    service.clear(TOPIC)
    expect(service.getView(TOPIC).overlay).toEqual({})

    // Frames from the (stopped) stream after clear must stay dropped.
    sub.emit(A, { type: 'text-delta', id: 't1', delta: '-stale' } as CherryUIMessageChunk)
    await nextFrame()
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
    await nextFrame()

    service.release(TOPIC, consumer)
    // A terminates while no consumer is mounted — the status edge that would
    // hand its frame off to the DB row fires unobserved.
    sub.terminal(A, { isAbort: false, isError: false }, 'anchor-a')
    await drainStreamMicrotasks()
    expect(textOf(service.getView(TOPIC).overlay['anchor-a'])).toBe('finished-while-away')

    service.acquire(TOPIC)
    service.syncExecutions(TOPIC, consumer, [exec(B, 'anchor-b')], seed)

    // A's retained frame yields to DB truth (fresh fetch on remount); B streams on.
    expect(service.getView(TOPIC).overlay['anchor-a']).toBeUndefined()
    expect(textOf(service.getView(TOPIC).overlay['anchor-b'])).toBe('still-live')
  })

  it('restarts a reader with the same execution and anchor after it finishes while released', async () => {
    const B = 'anthropic::claude' as UniqueModelId
    const service = new ExecutionStreamOverlayService()
    const consumer = {}
    const seed = () => [asst('anchor-a'), asst('anchor-b')]
    service.acquire(TOPIC)
    service.syncExecutions(TOPIC, consumer, [exec(A, 'anchor-a'), exec(B, 'anchor-b')], seed)
    const sub = mocks.subs.get(TOPIC)!

    streamText(sub, A, 't1', 'first')
    await nextFrame()
    service.release(TOPIC, consumer)

    sub.terminal(A, { isAbort: false, isError: false }, 'anchor-a')
    await drainStreamMicrotasks()

    expect(sub.branches.size).toBe(1)
    expect(sub.disposed).toBe(false)

    service.acquire(TOPIC)
    service.syncExecutions(TOPIC, consumer, [exec(A, 'anchor-a'), exec(B, 'anchor-b')], seed)
    expect(sub.branches.size).toBe(2)

    streamText(sub, A, 't2', 'second')
    await nextFrame()
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
    sub.terminal(A, { isAbort: true, isError: false })
    await drainStreamMicrotasks()

    expect(onFinish1).toHaveBeenCalledTimes(1)
    expect(onFinish2).toHaveBeenCalledTimes(1)
    expect(onFinish1.mock.calls[0][1].isAbort).toBe(true)
  })

  it('flushes stalled pending snapshots on acquire (hidden-window rAF stall)', async () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    const service = new ExecutionStreamOverlayService()
    const consumer = {}
    service.acquire(TOPIC)
    service.syncExecutions(TOPIC, consumer, [exec(A, 'anchor-a')], getSeed)
    const sub = mocks.subs.get(TOPIC)!

    streamText(sub, A, 't1', 'stalled')
    await drainStreamMicrotasks()
    // Frame never fired — the view is stale…
    expect(service.getView(TOPIC).overlay['anchor-a']).toBeUndefined()

    // …until a consumer re-acquires, which materializes pending frames.
    service.acquire(TOPIC)
    expect(textOf(service.getView(TOPIC).overlay['anchor-a'])).toBe('stalled')
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
