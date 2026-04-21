import { BaseService } from '@main/core/lifecycle/BaseService'
import type { SerializedError } from '@shared/types/error'
import type { UIMessageChunk } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AiStreamRequest } from '../../AiService'
import type {
  AiStreamManagerConfig,
  StreamDoneResult,
  StreamErrorResult,
  StreamListener,
  StreamPausedResult
} from '../types'

// ── Fake listener ───────────────────────────────────────────────────

class FakeListener implements StreamListener {
  readonly id: string
  chunks: UIMessageChunk[] = []
  /** Second argument of each onChunk call, indexed by chunk position. */
  chunkSources: Array<string | undefined> = []
  doneResults: StreamDoneResult[] = []
  pausedResults: StreamPausedResult[] = []
  errorResults: StreamErrorResult[] = []
  alive = true
  onDoneImpl?: (result: StreamDoneResult) => void | Promise<void>
  onPausedImpl?: (result: StreamPausedResult) => void | Promise<void>

  constructor(id: string) {
    this.id = id
  }

  onChunk(chunk: UIMessageChunk, sourceModelId?: string): void {
    this.chunks.push(chunk)
    this.chunkSources.push(sourceModelId)
  }

  onDone(result: StreamDoneResult): void | Promise<void> {
    this.doneResults.push(result)
    return this.onDoneImpl?.(result)
  }

  onPaused(result: StreamPausedResult): void | Promise<void> {
    this.pausedResults.push(result)
    return this.onPausedImpl?.(result)
  }

  onError(result: StreamErrorResult): void {
    this.errorResults.push(result)
  }

  isAlive(): boolean {
    return this.alive
  }
}

// ── Mocks ───────────────────────────────────────────────────────────

vi.mock('@main/data/services/MessageService', () => ({
  messageService: { create: vi.fn().mockResolvedValue({ id: 'msg-001' }) }
}))

// Default mock: never-closing stream so the execution loop parks in `reader.read()`
// and tests can drive terminal state (onExecutionDone / onExecutionError /
// abort + onExecutionPaused) explicitly.
function pendingStream(): ReadableStream<UIMessageChunk> {
  return new ReadableStream<UIMessageChunk>({
    start() {
      // Intentionally no enqueue / close. Cancel is a no-op.
    }
  })
}

/** A stream whose feed is driven from the test body (enqueue / close). */
function controlledStream(): {
  stream: ReadableStream<UIMessageChunk>
  enqueue: (chunk: UIMessageChunk) => void
  close: () => void
} {
  let controller!: ReadableStreamDefaultController<UIMessageChunk>
  const stream = new ReadableStream<UIMessageChunk>({
    start(c) {
      controller = c
    }
  })
  return {
    stream,
    enqueue: (chunk) => controller.enqueue(chunk),
    close: () => controller.close()
  }
}

const mockStreamText = vi.fn<(request: AiStreamRequest) => Promise<ReadableStream<UIMessageChunk>>>(async () =>
  pendingStream()
)

/**
 * Fake WindowManager used by broadcast-path tests. Tests push real-ish
 * `{ webContents: { send } }` shapes via `makeFakeWindow()`; the manager's
 * `broadcastTopicStatus` helper now goes through
 * `WindowManager.broadcastToType(WindowType.Main, ...)`, so the mock
 * treats every registered fake window as a Main-type window and forwards
 * the send call — the existing tests only care that `send()` lands on
 * every fake window and don't model the type distinction.
 */
const fakeWindows: Array<{ webContents: { isDestroyed: () => boolean; send: ReturnType<typeof vi.fn> } }> = []
const dispatchToFakeWindows = (channel: string, ...args: unknown[]) => {
  for (const window of fakeWindows) {
    if (!window.webContents.isDestroyed()) {
      window.webContents.send(channel, ...args)
    }
  }
}
const fakeWindowManager = {
  broadcast: vi.fn(dispatchToFakeWindows),
  broadcastToType: vi.fn((_type: unknown, channel: string, ...args: unknown[]) =>
    dispatchToFakeWindows(channel, ...args)
  ),
  getAllWindows: vi.fn(() => fakeWindows),
  getWindowsByType: vi.fn(() => [])
}

function makeFakeWindow() {
  const send = vi.fn()
  const window = { webContents: { isDestroyed: () => false, send } }
  fakeWindows.push(window)
  return { window, send }
}

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  // `AiService` is not in the shared `ServiceOverrides` union (which only
  // enumerates the minimal set of mocked core services). Cast to widen —
  // AiStreamManager reaches for `application.get('AiService')` at runtime,
  // and the mock factory's lookup is keyed by string so the extra entry
  // is wired up regardless of the type.
  return mockApplicationFactory({
    AiService: { streamText: mockStreamText },
    WindowManager: fakeWindowManager
  } as Parameters<typeof mockApplicationFactory>[0])
})

// ── Import after mocks ──────────────────────────────────────────────

const { AiStreamManager } = await import('../AiStreamManager')

// ── Helpers ─────────────────────────────────────────────────────────

type ManagerInstance = InstanceType<typeof AiStreamManager>

function createManager(config?: Partial<AiStreamManagerConfig>): ManagerInstance {
  BaseService.resetInstances()
  // Cast through unknown to bypass the lifecycle-decorated no-arg signature
  // in tests — the runtime constructor accepts `Partial<AiStreamManagerConfig>`.
  const Ctor = AiStreamManager as unknown as new (config?: Partial<AiStreamManagerConfig>) => ManagerInstance
  return new Ctor(config)
}

function chunk(text: string): UIMessageChunk {
  return { type: 'text-delta', delta: text, id: 'p1' } as unknown as UIMessageChunk
}

function error(msg: string): SerializedError {
  return { name: 'Error', message: msg, stack: null }
}

function req(topicId: string) {
  return { chatId: topicId, trigger: 'submit-message', messages: [] } as any
}

/**
 * Single-model convenience wrapper around `manager.send`.
 * Returns the resulting snapshot so tests can assert on observable state
 * without poking the manager's private map.
 */
function startSingle(
  manager: ManagerInstance,
  opts: {
    topicId: string
    modelId: `${string}::${string}`
    request: AiStreamRequest
    listeners: StreamListener[]
    siblingsGroupId?: number
  }
) {
  manager.send({
    topicId: opts.topicId,
    models: [{ modelId: opts.modelId, request: opts.request }],
    listeners: opts.listeners,
    siblingsGroupId: opts.siblingsGroupId
  })
  const snapshot = manager.inspect(opts.topicId)
  if (!snapshot) throw new Error(`inspect() returned undefined for topicId=${opts.topicId}`)
  return snapshot
}

// ── Tests ───────────────────────────────────────────────────────────

describe('AiStreamManager', () => {
  let mgr: ReturnType<typeof createManager>

  beforeEach(() => {
    vi.useFakeTimers()
    mgr = createManager()
    vi.clearAllMocks()
    mockStreamText.mockImplementation(async () => pendingStream())
    fakeWindows.length = 0
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ── send (start path) ──────────────────────────────────────────────

  describe('send (start)', () => {
    it('creates an active stream and launches an execution loop against AiService.streamText', () => {
      const snap = startSingle(mgr, {
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        listeners: [new FakeListener('l:a')]
      })

      // Topics start in `pending` — the initial state before any chunk has
      // flowed from the provider. `onChunk` flips this to `streaming`.
      expect(snap).toMatchObject({
        topicId: 'a',
        status: 'pending',
        isMultiModel: false,
        listenerIds: ['l:a']
      })
      // One streamText call per execution — 1 for single-model.
      // Passing signal propagation is verified indirectly by abort-path tests
      // (e.g. `abort > sets status and triggers AbortController signal`).
      expect(mockStreamText).toHaveBeenCalledOnce()
    })

    it('throws on duplicate modelId within a single send call', () => {
      const request = req('a')
      expect(() =>
        mgr.send({
          topicId: 'a',
          models: [
            { modelId: 'provider-a::model-a', request },
            { modelId: 'provider-a::model-a', request }
          ],
          listeners: [new FakeListener('l:a')]
        })
      ).toThrow('duplicate modelId')
    })

    it('evicts finished stream and creates new one', async () => {
      startSingle(mgr, {
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        listeners: [new FakeListener('l1:a')]
      })
      await mgr.onExecutionDone('a', 'provider-a::model-a')

      const s2 = startSingle(mgr, {
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        listeners: [new FakeListener('l2:a')]
      })
      expect(s2.status).toBe('pending')
      expect(s2.executions).toHaveLength(1)
    })
  })

  // ── send (inject path) ─────────────────────────────────────────────

  describe('send (inject)', () => {
    it('injects into existing stream without calling streamText again', () => {
      const l1 = new FakeListener('l:a')
      startSingle(mgr, {
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        listeners: [l1]
      })
      expect(mockStreamText).toHaveBeenCalledTimes(1)

      const l2 = new FakeListener('l:a') // same id → upsert
      const result = mgr.send({
        topicId: 'a',
        models: [{ modelId: 'provider-a::model-a', request: req('a') }],
        userMessage: {
          id: 'user-2',
          topicId: 'a',
          parentId: null,
          role: 'user',
          data: {},
          status: 'success',
          createdAt: '',
          updatedAt: ''
        } as any,
        listeners: [l2]
      })

      expect(result.mode).toBe('injected')
      expect(result.executionIds).toEqual(['provider-a::model-a'])
      // No second streamText call — message injection reuses the existing stream
      expect(mockStreamText).toHaveBeenCalledTimes(1)

      // Snapshot reflects the inject side-effects:
      //  - the execution's pending queue now has one message
      //  - the listener id is still the single "l:a" (upsert, not duplicate)
      const snap = mgr.inspect('a')!
      expect(snap.executions[0].pendingMessageCount).toBe(1)
      expect(snap.listenerIds).toEqual(['l:a'])

      // Behaviour proves the listener was actually replaced: only l2 sees the chunk.
      mgr.onChunk('a', 'provider-a::model-a', chunk('x'))
      expect(l1.chunks).toHaveLength(0)
      expect(l2.chunks).toHaveLength(1)
    })
  })

  // ── multi-model start ──────────────────────────────────────────────

  describe('send (multi-model)', () => {
    it('launches one execution per model in a single call', () => {
      const listener = new FakeListener('l:a')
      const result = mgr.send({
        topicId: 'a',
        models: [
          { modelId: 'provider-a::model-a', request: req('a') },
          { modelId: 'provider-b::model-b', request: req('a') }
        ],
        listeners: [listener]
      })

      expect(result).toEqual({
        mode: 'started',
        executionIds: ['provider-a::model-a', 'provider-b::model-b']
      })
      expect(mockStreamText).toHaveBeenCalledTimes(2)

      const snap = mgr.inspect('a')!
      expect(snap.executions).toHaveLength(2)
      expect(snap.isMultiModel).toBe(true)
      expect(snap.listenerIds).toEqual(['l:a'])

      // Each execution starts with an empty queue (no injected message yet).
      for (const exec of snap.executions) {
        expect(exec.pendingMessageCount).toBe(0)
      }

      // Behaviour: the single shared listener receives from either execution.
      mgr.onChunk('a', 'provider-a::model-a', chunk('from-a'))
      expect(listener.chunks).toHaveLength(1)
    })

    it('fans injected messages out to every execution queue', () => {
      mgr.send({
        topicId: 'a',
        models: [
          { modelId: 'provider-a::model-a', request: req('a') },
          { modelId: 'provider-b::model-b', request: req('a') }
        ],
        listeners: [new FakeListener('l:a')]
      })

      const injected = mgr.injectMessage('a', {
        id: 'inject-1',
        topicId: 'a',
        parentId: null,
        role: 'user',
        data: {},
        status: 'success',
        createdAt: '',
        updatedAt: ''
      } as any)

      expect(injected).toBe(true)
      // Every execution's own queue received the injected message — this
      // is the multi-model invariant: one inject, N consumers, no data loss.
      const snap = mgr.inspect('a')!
      expect(snap.executions).toHaveLength(2)
      for (const exec of snap.executions) {
        expect(exec.pendingMessageCount).toBe(1)
      }
    })

    it('tags chunks with sourceModelId in multi-model mode (and omits it for single-model)', () => {
      const multi = new FakeListener('l:multi')
      mgr.send({
        topicId: 'a',
        models: [
          { modelId: 'provider-a::model-a', request: req('a') },
          { modelId: 'provider-b::model-b', request: req('a') }
        ],
        listeners: [multi]
      })
      mgr.onChunk('a', 'provider-b::model-b', chunk('hi'))
      expect(multi.chunkSources).toEqual(['provider-b::model-b'])

      // Single-model topic: sourceModelId is intentionally omitted so the
      // renderer's demux doesn't need to special-case the common case.
      const single = new FakeListener('l:single')
      startSingle(mgr, {
        topicId: 'b',
        modelId: 'provider-c::model-c',
        request: req('b'),
        listeners: [single]
      })
      mgr.onChunk('b', 'provider-c::model-c', chunk('ho'))
      expect(single.chunkSources).toEqual([undefined])
    })
  })

  // ── onChunk (multicast) ─────────────────────────────────────────

  describe('onChunk', () => {
    it('multicasts to all alive listeners', () => {
      const l1 = new FakeListener('l1:a')
      const l2 = new FakeListener('l2:a')
      startSingle(mgr, { topicId: 'a', modelId: 'provider-a::model-a', request: req('a'), listeners: [l1, l2] })

      mgr.onChunk('a', 'provider-a::model-a', chunk('hi'))

      expect(l1.chunks).toEqual([chunk('hi')])
      expect(l2.chunks).toEqual([chunk('hi')])
    })

    it('removes dead listeners and skips delivery to them', () => {
      const alive = new FakeListener('alive:a')
      const dead = new FakeListener('dead:a')
      dead.alive = false

      startSingle(mgr, {
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        listeners: [alive, dead]
      })
      mgr.onChunk('a', 'provider-a::model-a', chunk('x'))

      expect(alive.chunks).toHaveLength(1)
      expect(dead.chunks).toHaveLength(0)
      // The dead listener was removed from the map during delivery.
      expect(mgr.inspect('a')!.listenerIds).toEqual(['alive:a'])
    })

    it('buffers chunks and replays to late-joining listener', () => {
      startSingle(mgr, {
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        listeners: [new FakeListener('early:a')]
      })
      mgr.onChunk('a', 'provider-a::model-a', chunk('a'))
      mgr.onChunk('a', 'provider-a::model-a', chunk('b'))

      const late = new FakeListener('late:a')
      mgr.addListener('a', late)

      expect(late.chunks).toEqual([chunk('a'), chunk('b')])
    })

    it('does not deliver to a non-streaming topic', async () => {
      const l = new FakeListener('l:a')
      startSingle(mgr, { topicId: 'a', modelId: 'provider-a::model-a', request: req('a'), listeners: [l] })
      await mgr.onExecutionDone('a', 'provider-a::model-a')

      mgr.onChunk('a', 'provider-a::model-a', chunk('late'))
      expect(l.chunks).toHaveLength(0)
    })

    it('backgroundMode=abort aborts the stream when all listeners go dead', () => {
      // Fresh manager with the abort policy configured at construction time,
      // rather than poking runtime state on the default instance.
      const abortMgr = createManager({ backgroundMode: 'abort' })
      const listener = new FakeListener('l:a')
      startSingle(abortMgr, {
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        listeners: [listener]
      })

      // Next chunk delivery scrubs the dead listener, finds size === 0,
      // and triggers abort so the execution exits via the paused path.
      listener.alive = false
      abortMgr.onChunk('a', 'provider-a::model-a', chunk('late'))

      const snap = abortMgr.inspect('a')!
      expect(snap.listenerIds).toEqual([])
      expect(snap.status).toBe('aborted')
      expect(snap.executions[0].abortSignal.aborted).toBe(true)
    })
  })

  // ── onExecutionDone ─────────────────────────────────────────────

  describe('onExecutionDone', () => {
    // The "dispatches finalMessage to listeners" behaviour is covered by
    // `live finalMessage accumulation > writes exec.finalMessage via the
    // accumulator before the terminal event fires` — that test drives a
    // real stream end-to-end and asserts listener.doneResults[0].finalMessage
    // is the same reference the manager holds.

    it('maps paused status to aborted state', async () => {
      const l = new FakeListener('l:a')
      startSingle(mgr, {
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        listeners: [l]
      })
      mgr.abort('a', 'test-pause')

      // abort() cancels the tee reader(s), so the execution loop exits and
      // calls onExecutionPaused. Drain microtasks so the broadcast lands
      // before we assert.
      for (let i = 0; i < 20; i++) await Promise.resolve()

      expect(mgr.inspect('a')!.status).toBe('aborted')
      expect(l.pausedResults).toHaveLength(1)
    })

    it('isolates listener errors — one throw does not block others', async () => {
      const thrower = new FakeListener('thrower:a')
      thrower.onDoneImpl = () => {
        throw new Error('listener bug')
      }
      const receiver = new FakeListener('receiver:a')

      startSingle(mgr, {
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        listeners: [thrower, receiver]
      })
      await mgr.onExecutionDone('a', 'provider-a::model-a')

      // Both listeners received onDone despite thrower throwing
      expect(thrower.doneResults).toHaveLength(1)
      expect(receiver.doneResults).toHaveLength(1)
    })
  })

  // ── onExecutionError ────────────────────────────────────────────

  describe('onExecutionError', () => {
    it('broadcasts error and sets stream status', async () => {
      const l = new FakeListener('l:a')
      startSingle(mgr, {
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        listeners: [l]
      })

      await mgr.onExecutionError('a', 'provider-a::model-a', error('fail'))

      expect(mgr.inspect('a')!.status).toBe('error')
      expect(l.errorResults).toHaveLength(1)
      expect(l.errorResults[0]).toMatchObject({ status: 'error', error: error('fail') })
    })
  })

  // ── abort ───────────────────────────────────────────────────────

  describe('abort', () => {
    it('sets status and triggers AbortController signal', () => {
      startSingle(mgr, {
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        listeners: [new FakeListener('l:a')]
      })

      mgr.abort('a', 'user-stop')

      const snap = mgr.inspect('a')!
      expect(snap.status).toBe('aborted')
      expect(snap.executions[0].abortSignal.aborted).toBe(true)
    })

    it('does not affect non-streaming topics', async () => {
      startSingle(mgr, {
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        listeners: [new FakeListener('l:a')]
      })
      await mgr.onExecutionDone('a', 'provider-a::model-a')

      // Abort on a finished stream → no-op (status stays 'done')
      mgr.abort('a', 'late')
      expect(mgr.inspect('a')!.status).toBe('done')
    })
  })

  // ── listener management ─────────────────────────────────────────
  // Listener upsert-by-id is exercised by `send (inject) > injects into
  // existing stream without calling streamText again`, which swaps listeners
  // with the same id and verifies only the new one receives chunks.

  describe('listener management', () => {
    it('removeListener prevents further delivery', () => {
      const l = new FakeListener('l:a')
      startSingle(mgr, { topicId: 'a', modelId: 'provider-a::model-a', request: req('a'), listeners: [l] })

      mgr.removeListener('a', 'l:a')
      mgr.onChunk('a', 'provider-a::model-a', chunk('x'))

      expect(l.chunks).toHaveLength(0)
    })
  })

  // ── grace period ────────────────────────────────────────────────

  describe('grace period', () => {
    it('attach returns compact replay chunks', () => {
      startSingle(mgr, {
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        listeners: [new FakeListener('l:a')]
      })
      mgr.onChunk('a', 'provider-a::model-a', { type: 'text-start', id: 'p1' } as UIMessageChunk)
      mgr.onChunk('a', 'provider-a::model-a', { type: 'text-delta', id: 'p1', delta: 'hel' } as UIMessageChunk)
      mgr.onChunk('a', 'provider-a::model-a', { type: 'text-delta', id: 'p1', delta: 'lo' } as UIMessageChunk)
      mgr.onChunk('a', 'provider-a::model-a', { type: 'text-end', id: 'p1' } as UIMessageChunk)

      const sender = { id: 1, isDestroyed: () => false, send: vi.fn() }
      // `attach` is the public IPC-facing method; tests pass a minimal
      // WebContents-shaped stub.
      const response = mgr.attach(sender as unknown as Electron.WebContents, { topicId: 'a' })

      expect(response).toEqual({
        status: 'attached',
        bufferedChunks: [
          { topicId: 'a', executionId: undefined, chunk: { type: 'text-start', id: 'p1' } },
          { topicId: 'a', executionId: undefined, chunk: { type: 'text-delta', id: 'p1', delta: 'hello' } },
          { topicId: 'a', executionId: undefined, chunk: { type: 'text-end', id: 'p1' } }
        ]
      })
    })

    it('per-execution ring buffer drops oldest chunk on overflow and tracks droppedChunks', () => {
      // Configure the cap via constructor rather than mutating runtime state;
      // this is the same surface the lifecycle container / future config
      // pipeline would use in production.
      const ringMgr = createManager({ maxBufferChunks: 3 })
      startSingle(ringMgr, {
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        listeners: [new FakeListener('l:a')]
      })

      for (let i = 0; i < 5; i++) {
        ringMgr.onChunk('a', 'provider-a::model-a', {
          type: 'text-delta',
          id: 'p',
          delta: String(i)
        } as UIMessageChunk)
      }

      const snap = ringMgr.inspect('a')!
      expect(snap.executions[0].bufferedChunkCount).toBe(3)
      expect(snap.executions[0].droppedChunks).toBe(2)

      // Behavioural check: a late listener replays exactly the three chunks
      // that survived the ring's eviction (the last three deltas).
      const late = new FakeListener('late:a')
      ringMgr.addListener('a', late)
      expect(late.chunks.map((c: any) => c.delta)).toEqual(['2', '3', '4'])
    })

    it('stream remains accessible during grace period', async () => {
      const l = new FakeListener('l:a')
      startSingle(mgr, { topicId: 'a', modelId: 'provider-a::model-a', request: req('a'), listeners: [l] })
      await mgr.onExecutionDone('a', 'provider-a::model-a')

      // During grace period: execution has completed but stream state is
      // still in memory — a reconnect can still attach and catch up.
      const snap = mgr.inspect('a')
      expect(snap?.status).toBe('done')
      const added = mgr.addListener('a', new FakeListener('late:a'))
      expect(added).toBe(true)
    })

    it('stream is cleaned up after grace period expires', async () => {
      startSingle(mgr, {
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        listeners: [new FakeListener('l:a')]
      })
      await mgr.onExecutionDone('a', 'provider-a::model-a')

      // Advance past grace period (default 30s)
      vi.advanceTimersByTime(31_000)

      // Stream should be gone — addListener returns false
      const late = new FakeListener('late:a')
      expect(mgr.addListener('a', late)).toBe(false)
    })
  })

  // ── injectMessage ───────────────────────────────────────────────

  // `injectMessage()` (direct call) is the single-model subset of the
  // multi-model fan-out tested under
  // `send (multi-model) > fans injected messages out to every execution
  // queue`. No dedicated test here — the fan-out test covers the invariant
  // for 1-to-N executions, and single-model is the N=1 case.

  // ── live finalMessage accumulation ──────────────────────────────

  describe('live finalMessage accumulation', () => {
    it('writes exec.finalMessage via the accumulator before the terminal event fires', async () => {
      // readUIMessageStream relies on real microtask / timer scheduling
      // internally; fake timers starve its reader loop. Use real timers
      // for this test only — the afterEach swaps fake timers back in.
      vi.useRealTimers()

      const controlled = controlledStream()
      mockStreamText.mockImplementationOnce(async () => controlled.stream)

      const listener = new FakeListener('l:a')
      startSingle(mgr, {
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        listeners: [listener]
      })

      // Feed a complete message — the AI SDK stream shape requires both
      // message-level `start` / `finish` boundaries and the text-part
      // triplet for readUIMessageStream to yield a UIMessage snapshot.
      controlled.enqueue({ type: 'start' } as UIMessageChunk)
      controlled.enqueue({ type: 'text-start', id: 'p1' } as UIMessageChunk)
      controlled.enqueue({ type: 'text-delta', id: 'p1', delta: 'hello' } as UIMessageChunk)
      controlled.enqueue({ type: 'text-end', id: 'p1' } as UIMessageChunk)
      controlled.enqueue({ type: 'finish' } as UIMessageChunk)
      controlled.close()

      // Let the tee → accumulator → terminal chain drain on real timers.
      await new Promise((resolve) => setTimeout(resolve, 50))

      const snap = mgr.inspect('a')!
      expect(snap.status).toBe('done')

      // The terminal event received the same finalMessage that inspect()
      // now reports — proof that the accumulator wrote before the terminal
      // broadcast rather than after it.
      expect(listener.doneResults).toHaveLength(1)
      expect(listener.doneResults[0].finalMessage).toBe(snap.executions[0].finalMessage)

      const parts = (snap.executions[0].finalMessage?.parts ?? []) as Array<{ type: string; text?: string }>
      expect(parts.some((p) => p.type === 'text' && p.text === 'hello')).toBe(true)

      // Transport-side timings are the only thing the manager tracks —
      // `startedAt` is always set on execution-loop entry and `completedAt` when the
      // broadcast loop exits. Semantic timings (firstTextAt, reasoning*)
      // live on listeners that inspect chunk payloads; the manager itself
      // is chunk-shape-agnostic. Ordering invariants are the stable
      // contract; exact numbers depend on real-timer drift.
      const timings = snap.executions[0].timings
      expect(timings.startedAt).toBeGreaterThan(0)
      expect(timings.completedAt).toBeGreaterThanOrEqual(timings.startedAt)
      // Proof of the new layering: no semantic field leaks into the
      // transport-owned `exec.timings` — keeps manager robust to AI SDK
      // chunk shape changes.
      expect(timings).not.toHaveProperty('firstTextAt')
      expect(timings).not.toHaveProperty('reasoningStartedAt')

      // The same timings land in the terminal result the listener received
      // (snapshot copy, so equal-but-not-same-reference is expected).
      expect(listener.doneResults[0].timings).toEqual(timings)
    })
  })

  // ── Topic status broadcast ──────────────────────────────────────
  //
  // These tests cover the `Ai_TopicStatusChanged` push channel — the new
  // surface that lets every window track topic state without attaching a
  // chunk listener. Each test wires one or more fake WebContents via
  // `makeFakeWindow()` and asserts the sequence of `send` calls.

  describe('topic status broadcast', () => {
    /** Filter captured `send` calls to just our channel and extract the payload status. */
    function statusSequence(send: ReturnType<typeof vi.fn>): string[] {
      return send.mock.calls
        .filter(([channel]) => channel === 'ai:topic-status-changed')
        .map(([, payload]) => (payload as { status: string }).status)
    }

    it('broadcasts pending on send, streaming on first chunk, done on terminal; grace-period cleanup is silent', async () => {
      const { send: sendA } = makeFakeWindow()
      const { send: sendB } = makeFakeWindow()
      startSingle(mgr, {
        topicId: 't',
        modelId: 'p::m',
        request: req('t'),
        listeners: [new FakeListener('l:t')]
      })
      expect(statusSequence(sendA)).toEqual(['pending'])
      expect(statusSequence(sendB)).toEqual(['pending'])

      // First chunk flips pending → streaming for every window.
      mgr.onChunk('t', 'p::m', chunk('hi'))
      expect(statusSequence(sendA)).toEqual(['pending', 'streaming'])
      expect(statusSequence(sendB)).toEqual(['pending', 'streaming'])

      // Subsequent chunks do NOT re-broadcast streaming.
      mgr.onChunk('t', 'p::m', chunk('ho'))
      expect(statusSequence(sendA)).toEqual(['pending', 'streaming'])

      await mgr.onExecutionDone('t', 'p::m')
      expect(statusSequence(sendA)).toEqual(['pending', 'streaming', 'done'])

      // Grace-period cleanup is silent — no status broadcast fires. Cache
      // mirrors retain the `done` value until a local consumer evicts it.
      vi.advanceTimersByTime(31_000)
      expect(statusSequence(sendA)).toEqual(['pending', 'streaming', 'done'])
    })

    it('broadcasts aborted when the user stops the stream', async () => {
      const { send } = makeFakeWindow()
      startSingle(mgr, {
        topicId: 't',
        modelId: 'p::m',
        request: req('t'),
        listeners: [new FakeListener('l:t')]
      })
      mgr.abort('t', 'user-stop')
      // Drain microtasks so `onExecutionPaused` resolves and the terminal
      // broadcast lands.
      for (let i = 0; i < 20; i++) await Promise.resolve()

      expect(statusSequence(send)).toEqual(['pending', 'aborted'])
    })

    it('broadcasts error when an execution errors before any chunk', async () => {
      const { send } = makeFakeWindow()
      startSingle(mgr, {
        topicId: 't',
        modelId: 'p::m',
        request: req('t'),
        listeners: [new FakeListener('l:t')]
      })
      await mgr.onExecutionError('t', 'p::m', error('boom'))

      // pending → error directly; we never fabricate a `streaming` transition
      // when no chunks ever flowed.
      expect(statusSequence(send)).toEqual(['pending', 'error'])
    })

    it('multi-model: flips on first chunk from any execution and stays pending if an execution errors before any chunks', async () => {
      const { send } = makeFakeWindow()
      mgr.send({
        topicId: 't',
        models: [
          { modelId: 'p::a', request: req('t') },
          { modelId: 'p::b', request: req('t') }
        ],
        listeners: [new FakeListener('l:t')]
      })
      // Initial pending broadcast.
      expect(statusSequence(send)).toEqual(['pending'])

      // Execution A errors before any chunk flowed on either execution.
      // Topic is still pending (B is live, no chunks yet) — no spurious
      // `streaming` transition should be broadcast.
      await mgr.onExecutionError('t', 'p::a', error('early'))
      expect(statusSequence(send)).toEqual(['pending'])
      expect(mgr.inspect('t')!.status).toBe('pending')

      // First chunk from B flips the topic.
      mgr.onChunk('t', 'p::b', chunk('x'))
      expect(statusSequence(send)).toEqual(['pending', 'streaming'])
    })

    it('skips destroyed WebContents', () => {
      const { send: aliveSend } = makeFakeWindow()
      const deadSend = vi.fn()
      fakeWindows.push({ webContents: { isDestroyed: () => true, send: deadSend } })
      startSingle(mgr, {
        topicId: 't',
        modelId: 'p::m',
        request: req('t'),
        listeners: [new FakeListener('l:t')]
      })

      expect(statusSequence(aliveSend)).toEqual(['pending'])
      expect(deadSend).not.toHaveBeenCalled()
    })

    it('carries activeExecutionIds in every status delta', async () => {
      const { send } = makeFakeWindow()
      mgr.send({
        topicId: 't',
        models: [
          { modelId: 'p::a', request: req('t') },
          { modelId: 'p::b', request: req('t') }
        ],
        listeners: [new FakeListener('l:t')]
      })

      /** Extract status + activeExecutionIds from our channel (topicId stripped). */
      const deltas = () =>
        send.mock.calls
          .filter(([channel]) => channel === 'ai:topic-status-changed')
          .map(([, payload]) => {
            const { status, activeExecutionIds } = payload as {
              status: string
              activeExecutionIds: string[]
            }
            return { status, activeExecutionIds }
          })

      // On send all executions are launched → both listed as active.
      expect(deltas()).toEqual([{ status: 'pending', activeExecutionIds: ['p::a', 'p::b'] }])

      // Per-execution terminals that don't take the topic terminal do NOT
      // re-broadcast (topic still live). Renderer cache retains the
      // launch-time exec list, matching the old onStreamChunk semantics.
      await mgr.onExecutionError('t', 'p::a', error('boom'))
      expect(deltas()).toHaveLength(1)

      // First chunk flips topic → 'streaming'. `collectActiveExecutionIds`
      // filters by `exec.status === 'streaming'`, so p::a (now 'error')
      // is dropped even though the broadcast itself is driven by the
      // topic transition, not the per-exec terminal.
      mgr.onChunk('t', 'p::b', chunk('x'))
      expect(deltas().at(-1)).toEqual({ status: 'streaming', activeExecutionIds: ['p::b'] })

      // B completes: topic terminal. Since A had errored, topic status
      // is 'error'. All execs are terminal → activeExecutionIds: [].
      const deltasBeforeCleanup = deltas().length
      await mgr.onExecutionDone('t', 'p::b')
      expect(deltas().at(-1)).toEqual({ status: 'error', activeExecutionIds: [] })

      // Grace-period cleanup is silent — no extra delta after the terminal one.
      vi.advanceTimersByTime(31_000)
      expect(deltas().length).toBe(deltasBeforeCleanup + 1)
    })
  })

  // ── getTopicStatuses snapshot ────────────────────────────────────

  describe('getTopicStatuses', () => {
    it('returns a map of every tracked topic by current status', async () => {
      startSingle(mgr, {
        topicId: 'a',
        modelId: 'p::m',
        request: req('a'),
        listeners: [new FakeListener('l:a')]
      })
      startSingle(mgr, {
        topicId: 'b',
        modelId: 'p::m',
        request: req('b'),
        listeners: [new FakeListener('l:b')]
      })
      mgr.onChunk('b', 'p::m', chunk('hi'))

      expect(mgr.getTopicStatuses()).toEqual({
        a: { status: 'pending', activeExecutionIds: ['p::m'] },
        b: { status: 'streaming', activeExecutionIds: ['p::m'] }
      })

      await mgr.onExecutionDone('b', 'p::m')
      expect(mgr.getTopicStatuses()).toEqual({
        a: { status: 'pending', activeExecutionIds: ['p::m'] },
        b: { status: 'done', activeExecutionIds: [] }
      })

      // After the grace period the cleaned-up topic drops out of the snapshot.
      vi.advanceTimersByTime(31_000)
      expect(mgr.getTopicStatuses()).toEqual({
        a: { status: 'pending', activeExecutionIds: ['p::m'] }
      })
    })
  })
})
