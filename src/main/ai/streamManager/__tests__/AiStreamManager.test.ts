import { BaseService } from '@main/core/lifecycle/BaseService'
import type { UniqueModelId } from '@shared/data/types/model'
import type { SerializedError } from '@shared/types/error'
import type { UIMessageChunk } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AiStreamRequest } from '../../types/requests'
import type {
  AiStreamManagerConfig,
  CherryUIMessage,
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
function pendingStream(signal?: AbortSignal): ReadableStream<UIMessageChunk> {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      // Real provider streams close when their upstream `AbortSignal` fires.
      // Tee'd downstream readers stall otherwise — the accumulator branch
      // keeps reading and `await accumulator` hangs in tests.
      if (signal) {
        if (signal.aborted) controller.close()
        else signal.addEventListener('abort', () => controller.close(), { once: true })
      }
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
 * In-memory stand-in for Main's `CacheService`. `AiStreamManager` writes
 * topic status transitions via `setShared('topic.stream.statuses.${topicId}', …)`
 * (per-topic template key); tests observe the sequence of writes against
 * this fake and assert each per-topic value.
 */
const sharedCacheStore = new Map<string, unknown>()
const fakeCacheService = {
  getShared: vi.fn((key: string) => sharedCacheStore.get(key)),
  setShared: vi.fn((key: string, value: unknown) => {
    sharedCacheStore.set(key, value)
  })
}
const mockSaveSpans = vi.fn<(topicId: string) => Promise<void>>(async () => undefined)
const mockWillContinueTopic = vi.fn<(topicId: string) => boolean>(() => false)

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  // `AiService` is not in the shared `ServiceOverrides` union (which only
  // enumerates the minimal set of mocked core services). Cast to widen —
  // AiStreamManager reaches for `application.get('AiService')` at runtime,
  // and the mock factory's lookup is keyed by string so the extra entry
  // is wired up regardless of the type.
  return mockApplicationFactory({
    AiService: { streamText: mockStreamText },
    CacheService: fakeCacheService,
    TraceStorageService: { saveSpans: mockSaveSpans },
    AgentSessionRuntimeService: { willContinueTopic: mockWillContinueTopic }
  } as Parameters<typeof mockApplicationFactory>[0])
})

// ── Import after mocks ──────────────────────────────────────────────

const { AiStreamManager } = await import('../AiStreamManager')
const { TraceFlushListener } = await import('../listeners/TraceFlushListener')

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
    mockStreamText.mockImplementation(async (request: AiStreamRequest) =>
      pendingStream((request.requestOptions as { signal?: AbortSignal } | undefined)?.signal)
    )
    mockSaveSpans.mockResolvedValue(undefined)
    mockWillContinueTopic.mockReturnValue(false)
    sharedCacheStore.clear()
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

    it('no-ops an enqueue-only send (empty models, not live) instead of throwing', () => {
      // A steer landing in the inter-turn drain window reaches send with no models and no live
      // stream: the user message is already persisted, so send must not require a model nor start
      // a stream — just return without effect.
      const result = mgr.send({ topicId: 'a', models: [], listeners: [new FakeListener('l:a')] })

      expect(result).toEqual({ mode: 'injected', executionIds: [] })
      expect(mgr.inspect('a')).toBeUndefined()
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
    it('upserts listeners onto a live stream without calling streamText again', () => {
      const l1 = new FakeListener('l:a')
      startSingle(mgr, {
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        listeners: [l1]
      })
      expect(mockStreamText).toHaveBeenCalledTimes(1)

      const l2 = new FakeListener('l:a') // same id → upsert
      // A live-topic inject carries no models (the running stream owns execution; a steer / agent
      // follow-up is enqueued separately by its provider). Non-empty models here is the refused race.
      const result = mgr.send({
        topicId: 'a',
        models: [],
        listeners: [l2]
      })

      expect(result.mode).toBe('injected')
      expect(result.executionIds).toEqual(['provider-a::model-a'])
      // No second streamText call — the live stream is reused.
      expect(mockStreamText).toHaveBeenCalledTimes(1)

      // The listener id is still the single "l:a" (upsert, not duplicate).
      const snap = mgr.inspect('a')!
      expect(snap.listenerIds).toEqual(['l:a'])

      // Behaviour proves the listener was actually replaced: only l2 sees the chunk.
      mgr.onChunk('a', 'provider-a::model-a', chunk('x'))
      expect(l1.chunks).toHaveLength(0)
      expect(l2.chunks).toHaveLength(1)
    })

    it('refuses to inject a prepared turn onto a live topic (approval continue-conversation race)', () => {
      // A non-empty `models` reaching the inject path means a prepared turn (e.g. an approval
      // `continue-conversation`) raced a concurrent submit that started a live turn. send() runs under
      // the per-topic dispatch lock, so throwing here is atomic w.r.t. the racing submit — it must NOT
      // silently inject-drop the prepared models behind a success shape (the approved tool never runs).
      startSingle(mgr, {
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        listeners: [new FakeListener('wc:1')]
      })
      expect(mockStreamText).toHaveBeenCalledTimes(1)

      expect(() =>
        mgr.send({
          topicId: 'a',
          models: [{ modelId: 'provider-a::model-a', request: req('a') }],
          listeners: [new FakeListener('wc:2')]
        })
      ).toThrow(/refusing to inject/)
      // No second stream launched; the live stream is untouched.
      expect(mockStreamText).toHaveBeenCalledTimes(1)
    })

    it('upserts an agent-session follow-up subscriber without restarting the stream', () => {
      startSingle(mgr, {
        topicId: 'agent-session:s1',
        modelId: 'provider-a::model-a',
        request: req('agent-session:s1'),
        listeners: [new FakeListener('l:a')]
      })
      expect(mockStreamText).toHaveBeenCalledTimes(1)

      const result = mgr.send({
        topicId: 'agent-session:s1',
        models: [],
        listeners: [new FakeListener('l:b')]
      })

      expect(result.mode).toBe('injected')
      expect(result.executionIds).toEqual(['provider-a::model-a'])
      expect(mockStreamText).toHaveBeenCalledTimes(1)
      expect(mgr.inspect('agent-session:s1')?.listenerIds).toEqual(['l:a', 'l:b'])
    })

    it('attaches a follow-up subscriber to a grace-period stream so the next turn carries it', async () => {
      // Drive an agent-session turn to terminal-but-kept-alive: the inter-turn
      // drain/grace window where the runtime will open the next turn.
      mockWillContinueTopic.mockReturnValue(true)
      const topicId = 'agent-session:s1'
      startSingle(mgr, {
        topicId,
        modelId: 'provider-a::model-a',
        request: req(topicId),
        listeners: [new FakeListener('l:a')]
      })
      await mgr.onExecutionDone(topicId, 'provider-a::model-a')
      // Settled stream is terminal-in-grace (not live), so a follow-up takes the
      // enqueue-only branch (models: []), not the live inject branch.
      expect(mgr.inspect(topicId)?.status).not.toBe('streaming')

      const result = mgr.send({ topicId, models: [], listeners: [new FakeListener('l:b')] })

      expect(result.mode).toBe('injected')
      expect(result.executionIds).toEqual([]) // enqueue-only branch, not inject
      // The follow-up subscriber must be attached to the grace stream so
      // startRuntimeTurn carries it into the next runtime turn instead of dropping it.
      expect(mgr.inspect(topicId)?.listenerIds).toContain('l:b')
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

      // Behaviour: the single shared listener receives from either execution.
      mgr.onChunk('a', 'provider-a::model-a', chunk('from-a'))
      expect(listener.chunks).toHaveLength(1)
    })

    it('tags every chunk with its sourceModelId (single- and multi-model)', () => {
      // Multi-model: each chunk carries the model that produced it.
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

      // Single-model: tagging is unconditional now — renderers all run
      // through per-execution `ExecutionStreamCollector`, which relies
      // on the modelId tag to demux chunks.
      const single = new FakeListener('l:single')
      startSingle(mgr, {
        topicId: 'b',
        modelId: 'provider-c::model-c',
        request: req('b'),
        listeners: [single]
      })
      mgr.onChunk('b', 'provider-c::model-c', chunk('ho'))
      expect(single.chunkSources).toEqual(['provider-c::model-c'])
    })

    it('tags single-model chunks consistently after the transitional flag was removed', () => {
      const listener = new FakeListener('l:flag')
      mgr.send({
        topicId: 'c',
        models: [{ modelId: 'provider-d::model-d', request: req('c') }],
        listeners: [listener]
      })
      mgr.onChunk('c', 'provider-d::model-d', chunk('tagged'))
      expect(listener.chunkSources).toEqual(['provider-d::model-d'])
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

      // Drain the microtask chain that follows the abort propagating through
      // the pipeStreamLoop, but stop short of the grace-period cleanup so
      // `inspect()` still returns the stream.
      await vi.advanceTimersByTimeAsync(0)

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

    it('flushes trace spans for completed chat topics', async () => {
      startSingle(mgr, {
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        listeners: [new FakeListener('l:a'), new TraceFlushListener('a')]
      })

      await mgr.onExecutionDone('a', 'provider-a::model-a')

      expect(mockSaveSpans).toHaveBeenCalledWith('a')
    })

    it('flushes trace spans for completed agent-session topics', async () => {
      startSingle(mgr, {
        topicId: 'agent-session:session-1',
        modelId: 'provider-a::model-a',
        request: req('agent-session:session-1'),
        listeners: [new FakeListener('l:a'), new TraceFlushListener('agent-session:session-1')]
      })

      await mgr.onExecutionDone('agent-session:session-1', 'provider-a::model-a')

      expect(mockSaveSpans).toHaveBeenCalledWith('agent-session:session-1')
    })

    it('keeps an agent-session stream alive when the runtime will continue', async () => {
      mockWillContinueTopic.mockReturnValue(true)
      const topicId = 'agent-session:session-1'
      const listener = new FakeListener(`l:${topicId}`)
      startSingle(mgr, {
        topicId,
        modelId: 'provider-a::model-a',
        request: req(topicId),
        listeners: [listener]
      })

      await mgr.onExecutionDone(topicId, 'provider-a::model-a')

      expect(listener.doneResults).toHaveLength(1)
      expect(listener.doneResults[0].isTopicDone).toBe(false)
      expect(mgr.inspect(topicId)).toBeDefined()
    })

    it('does not let trace flush failure block terminal completion', async () => {
      mockSaveSpans.mockRejectedValueOnce(new Error('trace write failed'))
      const listener = new FakeListener('l:a')
      startSingle(mgr, {
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        listeners: [listener, new TraceFlushListener('a')]
      })

      await expect(mgr.onExecutionDone('a', 'provider-a::model-a')).resolves.toBeUndefined()

      expect(listener.doneResults).toHaveLength(1)
      expect(mgr.inspect('a')?.status).toBe('done')
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

    it('uses the anchor message id when execution errors before receiving chunks', async () => {
      const l = new FakeListener('l:a')
      startSingle(mgr, {
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: { ...req('a'), messageId: 'assistant-1' },
        listeners: [l]
      })

      await mgr.onExecutionError('a', 'provider-a::model-a', error('fail'))

      expect(l.errorResults[0].finalMessage?.id).toBe('assistant-1')
      expect(mgr.inspect('a')!.executions[0].finalMessage?.id).toBe('assistant-1')
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

      const sender = { id: 1, isDestroyed: () => false, send: vi.fn(), once: vi.fn() }
      // `attach` is the public IPC-facing method; tests pass a minimal
      // WebContents-shaped stub.
      const response = mgr.attach(sender as unknown as Electron.WebContents, { topicId: 'a' })

      expect(response).toEqual({
        status: 'attached',
        bufferedChunks: [
          { topicId: 'a', executionId: 'provider-a::model-a', chunk: { type: 'text-start', id: 'p1' } },
          { topicId: 'a', executionId: 'provider-a::model-a', chunk: { type: 'text-delta', id: 'p1', delta: 'hello' } },
          { topicId: 'a', executionId: 'provider-a::model-a', chunk: { type: 'text-end', id: 'p1' } }
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

  // ── steer chaining ──────────────────────────────────────────────
  // Chat mirrors the agent runtime: a busy submit is persisted and enqueued here; the running turn
  // yields (`hasPendingSteer` → stop condition) and `onExecutionDone` chains a `steer-continuation`
  // dispatch that answers it. No second loop, no idle flicker, FIFO drain.

  describe('steer chaining', () => {
    // Flush the queueMicrotask-deferred continuation (and its awaited dispatch) under fake timers.
    const flush = async () => {
      for (let i = 0; i < 6; i++) await Promise.resolve()
    }
    const steerReq = (topicId: string, userMessageId: string) => ({
      trigger: 'steer-continuation',
      topicId,
      userMessageId
    })

    it('drains a steer that lands right after a clean `done` settle (inter-turn race)', async () => {
      // The turn completed cleanly before the steer's enqueue landed, so no terminal hook fired to
      // chain it — `enqueuePendingSteer` must drain it itself.
      const dispatchSpy = vi.spyOn(mgr, 'dispatch').mockResolvedValue({ mode: 'started', executionIds: [] } as any)
      startSingle(mgr, {
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        listeners: [new FakeListener('wc:1')]
      })
      await mgr.onExecutionDone('a', 'provider-a::model-a')
      dispatchSpy.mockClear()

      mgr.enqueuePendingSteer('a', 'u1')
      expect(mgr.hasPendingSteer('a')).toBe(true)

      await flush()
      expect(dispatchSpy).toHaveBeenCalledTimes(1)
      expect(dispatchSpy).toHaveBeenCalledWith(expect.anything(), steerReq('a', 'u1'))
      expect(mgr.hasPendingSteer('a')).toBe(false)
    })

    it('a finished turn with a queued steer chains a continuation instead of finishing (no idle flicker)', async () => {
      const dispatchSpy = vi.spyOn(mgr, 'dispatch').mockResolvedValue({ mode: 'started', executionIds: [] } as any)
      const listener = new FakeListener('l:a')
      startSingle(mgr, { topicId: 'a', modelId: 'provider-a::model-a', request: req('a'), listeners: [listener] })

      // Steer arrives while the turn is live → queued, not started.
      mgr.enqueuePendingSteer('a', 'u2')
      expect(dispatchSpy).not.toHaveBeenCalled()

      await mgr.onExecutionDone('a', 'provider-a::model-a')

      // The assistant bubble finalises but the topic stays busy (isTopicDone=false), and no
      // terminal `done` is broadcast to the status cache.
      expect(listener.doneResults).toHaveLength(1)
      expect(listener.doneResults[0].isTopicDone).toBe(false)
      expect((sharedCacheStore.get('topic.stream.statuses.a') as any)?.status).not.toBe('done')

      await flush()
      expect(dispatchSpy).toHaveBeenCalledWith(expect.anything(), steerReq('a', 'u2'))
    })

    it('drains multiple steers FIFO — only the head starts until the next turn finishes', async () => {
      const dispatchSpy = vi.spyOn(mgr, 'dispatch').mockResolvedValue({ mode: 'started', executionIds: [] } as any)
      startSingle(mgr, {
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        listeners: [new FakeListener('wc:1')]
      })
      // Both steers queued while the turn is live...
      mgr.enqueuePendingSteer('a', 'u1')
      mgr.enqueuePendingSteer('a', 'u2')
      expect(dispatchSpy).not.toHaveBeenCalled()

      // ...the turn finishes → only the head chains; the rest waits for the continuation to finish.
      await mgr.onExecutionDone('a', 'provider-a::model-a')
      await flush()
      expect(dispatchSpy).toHaveBeenCalledTimes(1)
      expect(dispatchSpy).toHaveBeenCalledWith(expect.anything(), steerReq('a', 'u1'))
      expect(mgr.hasPendingSteer('a')).toBe(true)
    })

    it('drops a queued steer when the turn is aborted instead of chaining onto it', async () => {
      const dispatchSpy = vi.spyOn(mgr, 'dispatch').mockResolvedValue({ mode: 'started', executionIds: [] } as any)
      const listener = new FakeListener('l:a')
      startSingle(mgr, { topicId: 'a', modelId: 'provider-a::model-a', request: req('a'), listeners: [listener] })
      mgr.enqueuePendingSteer('a', 'u2')

      mgr.abort('a', 'user-requested')
      await mgr.onExecutionPaused('a', 'provider-a::model-a')

      await flush()
      expect(dispatchSpy).not.toHaveBeenCalled()
      expect(mgr.hasPendingSteer('a')).toBe(false)
    })

    // ── failure paths: queue-drop, no-chain-on-error, continuation-launch failure ──

    it('drops — does not chain — a steer that lands after an aborted settle (Stop race)', async () => {
      // The user pressed Stop; the steer's enqueue lands AFTER the abort settled. It must not start a
      // turn after Stop, nor sit queued for a later unrelated turn to chain — it's dropped (the
      // persisted row stays resendable).
      const dispatchSpy = vi.spyOn(mgr, 'dispatch').mockResolvedValue({ mode: 'started', executionIds: [] } as any)
      startSingle(mgr, {
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        listeners: [new FakeListener('wc:1')]
      })
      mgr.abort('a', 'user-requested')
      await mgr.onExecutionPaused('a', 'provider-a::model-a')

      mgr.enqueuePendingSteer('a', 'u1')

      await flush()
      expect(dispatchSpy).not.toHaveBeenCalled()
      expect(mgr.hasPendingSteer('a')).toBe(false)
    })

    it('drops a steer landing after abort() but before the loop settles, even after a prior clean turn', async () => {
      // Stop race after a prior clean turn: a new turn is live, the user presses Stop (`abort()` flips
      // the stream to 'aborted' synchronously), and the steer enqueue lands BEFORE `onExecutionPaused`
      // runs. The enqueue reads 'aborted' off the in-grace stream and drops — it must not drain off
      // the earlier turn's clean 'done'.
      const dispatchSpy = vi.spyOn(mgr, 'dispatch').mockResolvedValue({ mode: 'started', executionIds: [] } as any)

      // 1) an earlier clean turn (settles to 'done')
      startSingle(mgr, {
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        listeners: [new FakeListener('l1')]
      })
      await mgr.onExecutionDone('a', 'provider-a::model-a')
      dispatchSpy.mockClear()

      // 2) a new live turn, 3) Stop (abort is synchronous), 4) steer lands before onExecutionPaused runs
      startSingle(mgr, {
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        listeners: [new FakeListener('l2')]
      })
      mgr.abort('a', 'user-requested')
      mgr.enqueuePendingSteer('a', 'u1')

      await flush()
      expect(dispatchSpy).not.toHaveBeenCalled()
      expect(mgr.hasPendingSteer('a')).toBe(false)
    })

    it('does not chain while an execution is awaiting approval', async () => {
      // A turn that ends `awaiting-approval` with a steer queued must NOT launch a continuation: the
      // user's Approve dispatches `continue-conversation`, which a live continuation would swallow.
      const dispatchSpy = vi.spyOn(mgr, 'dispatch').mockResolvedValue({ mode: 'started', executionIds: [] } as any)
      const listener = new FakeListener('wc:1')
      startSingle(mgr, { topicId: 'a', modelId: 'provider-a::model-a', request: req('a'), listeners: [listener] })
      // Drive the execution into awaiting-approval, then complete it.
      mgr.onChunk('a', 'provider-a::model-a', { type: 'tool-approval-request' } as unknown as UIMessageChunk)
      mgr.enqueuePendingSteer('a', 'u1')
      await mgr.onExecutionDone('a', 'provider-a::model-a')

      await flush()
      expect(dispatchSpy).not.toHaveBeenCalled()
      expect(mgr.hasPendingSteer('a')).toBe(true) // still queued, waiting for the approval to resolve
    })

    it('answers a steer that lands in the chaining window instead of dropping it (variant A)', async () => {
      // A first steer is queued and the turn chains (status flips to 'done'); a SECOND steer lands in
      // that chaining window. The old shadow flag wasn't recorded on the chaining settle, so the late
      // steer read `undefined` and was dropped; now it reads 'done' off the in-grace stream and stays.
      const dispatchSpy = vi.spyOn(mgr, 'dispatch').mockResolvedValue({ mode: 'started', executionIds: [] } as any)
      startSingle(mgr, {
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        listeners: [new FakeListener('wc:1')]
      })
      mgr.enqueuePendingSteer('a', 's0') // queued while live
      await mgr.onExecutionDone('a', 'provider-a::model-a') // clean done + queued steer → chains
      mgr.enqueuePendingSteer('a', 's1') // lands in the chaining window

      await flush()
      expect(dispatchSpy).toHaveBeenCalled() // s0's continuation launched
      expect(mgr.hasPendingSteer('a')).toBe(true) // s1 retained for the next drain, not dropped
    })

    it('queues a steer that lands after the turn parked on approval, without launching (variant B)', async () => {
      // As above, but the steer lands AFTER the park (not before): it must still queue for the
      // post-approval continuation, not read a non-live status and drop.
      const dispatchSpy = vi.spyOn(mgr, 'dispatch').mockResolvedValue({ mode: 'started', executionIds: [] } as any)
      startSingle(mgr, {
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        listeners: [new FakeListener('wc:1')]
      })
      mgr.onChunk('a', 'provider-a::model-a', { type: 'tool-approval-request' } as unknown as UIMessageChunk)
      await mgr.onExecutionDone('a', 'provider-a::model-a') // parks → 'awaiting-approval', no steer queued yet
      mgr.enqueuePendingSteer('a', 's1') // lands after the park

      await flush()
      expect(dispatchSpy).not.toHaveBeenCalled() // not launched while parked
      expect(mgr.hasPendingSteer('a')).toBe(true) // queued for the continuation Approve dispatches
    })

    it('never chains a steer onto a multi-model turn that resolved to error, in either settle order', async () => {
      const dispatchSpy = vi.spyOn(mgr, 'dispatch').mockResolvedValue({ mode: 'started', executionIds: [] } as any)
      const twoModels = (topicId: string) => ({
        topicId,
        models: [
          { modelId: 'provider-a::model-a' as const, request: req(topicId) },
          { modelId: 'provider-b::model-b' as const, request: req(topicId) }
        ],
        listeners: [new FakeListener(`wc:${topicId}`)]
      })

      // topic 'a': error settles FIRST, the clean done LAST (the order that mis-recorded 'done' pre-fix).
      mgr.send(twoModels('a'))
      mgr.enqueuePendingSteer('a', 's-a')
      await mgr.onExecutionError('a', 'provider-a::model-a', error('boom'))
      await mgr.onExecutionDone('a', 'provider-b::model-b') // resolves topic to 'error'

      // topic 'b': clean done FIRST, error LAST.
      mgr.send(twoModels('b'))
      mgr.enqueuePendingSteer('b', 's-b')
      await mgr.onExecutionDone('b', 'provider-a::model-a') // topic still live (B streaming)
      await mgr.onExecutionError('b', 'provider-b::model-b', error('boom'))

      await flush()
      // Neither order chains onto an errored topic; both drop the queued steer (rows stay resendable).
      expect(dispatchSpy).not.toHaveBeenCalled()
      expect(mgr.hasPendingSteer('a')).toBe(false)
      expect(mgr.hasPendingSteer('b')).toBe(false)
    })

    it('writes a terminal error and notifies carried windows when the continuation fails to launch', async () => {
      const wc = new FakeListener('wc:1')
      startSingle(mgr, { topicId: 'a', modelId: 'provider-a::model-a', request: req('a'), listeners: [wc] })
      mgr.enqueuePendingSteer('a', 'u1') // queued while live

      vi.spyOn(mgr, 'dispatch').mockRejectedValue(new Error('steer row deleted'))
      await mgr.onExecutionDone('a', 'provider-a::model-a') // chains → startNextChatTurn → dispatch throws
      await flush()

      // Status cache dropped out of the live state (not stuck `streaming`/`pending`).
      expect((sharedCacheStore.get('topic.stream.statuses.a') as any)?.status).toBe('error')
      // The carried renderer window was told the turn errored.
      expect(wc.errorResults).toHaveLength(1)
      // Queue cleared, not stranded; no live stream left behind.
      expect(mgr.hasPendingSteer('a')).toBe(false)
      expect(mgr.hasLiveStream('a')).toBe(false)
    })

    // The single line that prevents the prior turn's PersistenceListener from being carried into the
    // continuation (and writing onto the OLD assistant row) is the renderer-listener filter — cover it.
    it('carries only renderer listeners into the continuation; persistence/trace are dropped', async () => {
      const dispatchSpy = vi.spyOn(mgr, 'dispatch').mockResolvedValue({ mode: 'started', executionIds: [] } as any)
      const addSpy = vi.spyOn(mgr, 'addListener')
      const wc1 = new FakeListener('wc:1:a')
      const wc2 = new FakeListener('wc:2:a')
      const persist = new FakeListener('persistence:sqlite:a:provider-a::model-a')
      const trace = new FakeListener('trace:a')
      startSingle(mgr, {
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: req('a'),
        listeners: [wc1, persist, trace, wc2]
      })
      mgr.enqueuePendingSteer('a', 'u1')
      await mgr.onExecutionDone('a', 'provider-a::model-a')
      await flush()

      // The continuation's dispatch subscriber is a renderer (wc) listener — never the prior turn's
      // persistence/trace listener (carrying that would write onto the old assistant row / re-flush).
      const [subscriber, sentReq] = dispatchSpy.mock.calls[0]
      expect(subscriber.id.startsWith('wc:')).toBe(true)
      expect(sentReq).toEqual(steerReq('a', 'u1'))
      // The other window is re-attached; persistence/trace listeners are not carried at all.
      const reattachedIds = addSpy.mock.calls.map(([, l]) => l.id)
      expect(reattachedIds).toContain('wc:2:a')
      expect(reattachedIds).not.toContain('persistence:sqlite:a:provider-a::model-a')
      expect(reattachedIds).not.toContain('trace:a')
    })

    it('falls back to the null listener when the finished turn had no renderer windows', async () => {
      const dispatchSpy = vi.spyOn(mgr, 'dispatch').mockResolvedValue({ mode: 'started', executionIds: [] } as any)
      // Only a persistence listener (e.g. every window closed mid-turn) — nothing to carry.
      const persist = new FakeListener('persistence:sqlite:a:provider-a::model-a')
      startSingle(mgr, { topicId: 'a', modelId: 'provider-a::model-a', request: req('a'), listeners: [persist] })
      mgr.enqueuePendingSteer('a', 'u1')
      await mgr.onExecutionDone('a', 'provider-a::model-a')
      await flush()

      // The null sentinel (isAlive() === false) drives the windowless continuation, not the
      // persistence listener.
      const [subscriber] = dispatchSpy.mock.calls[0]
      expect(subscriber.isAlive()).toBe(false)
      expect(subscriber.id.startsWith('persistence:')).toBe(false)
    })
  })

  // ── idle timeout terminal classification ────────────────────────
  // The idle-chunk timer (withIdleTimeout) aborts `exec.abortController`
  // directly, never going through `mgr.abort`, so on the clean stream exit
  // `exec.status` is still 'streaming'. The loop must promote it to 'aborted'
  // and settle as `paused` — NOT a success `done`. Locks the recently-fixed
  // mis-classification bug.

  describe('idle timeout', () => {
    it('settles a timed-out execution as paused, not done', async () => {
      // readUIMessageStream's accumulator needs real microtask/timer
      // scheduling; fake timers starve it. The idle timer is a short real
      // `setTimeout`, so a brief real wait lets it fire.
      vi.useRealTimers()

      const listener = new FakeListener('l:a')
      startSingle(mgr, {
        topicId: 'a',
        modelId: 'provider-a::model-a',
        // 10ms idle timeout — the default pendingStream never emits, so the
        // idle timer fires and aborts exec.abortController on its own.
        request: { ...req('a'), requestOptions: { timeout: 10 } },
        listeners: [listener]
      })
      expect(mgr.inspect('a')!.status).toBe('pending')

      // Let the idle timer fire and the abort propagate through the loop.
      await new Promise((resolve) => setTimeout(resolve, 60))

      // Terminal is paused (truncated reply persisted as paused), never a
      // success done.
      expect(listener.pausedResults).toHaveLength(1)
      expect(listener.doneResults).toHaveLength(0)
      expect(listener.pausedResults[0].status).toBe('paused')
      expect(mgr.inspect('a')!.status).toBe('aborted')
    })

    it('pauses the idle timer while a tool is awaiting approval — a long deliberation is not killed', async () => {
      vi.useRealTimers()

      const controlled = controlledStream()
      mockStreamText.mockImplementationOnce(async () => controlled.stream)

      const listener = new FakeListener('l:a')
      startSingle(mgr, {
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: { ...req('a'), requestOptions: { timeout: 30 } },
        listeners: [listener]
      })

      // The approval-request chunk flows through the loop's onChunk callback, which re-arms the
      // idle watchdog to the generous approval bound (default 2 h). The stream then stays open with
      // no further chunks (the human is deliberating).
      controlled.enqueue({ type: 'start' } as UIMessageChunk)
      controlled.enqueue({ type: 'tool-approval-request', toolCallId: 'tc-1', approvalId: 'a-1' } as UIMessageChunk)

      // Wait well past the 30ms idle timeout — the approval re-arm uses the 2 h bound, so no abort.
      await new Promise((resolve) => setTimeout(resolve, 90))

      expect(listener.pausedResults).toHaveLength(0)
      expect(mgr.inspect('a')!.status).not.toBe('aborted')
    })

    it('still bounds an approval wait — an unresponsive renderer is aborted after the approval timeout', async () => {
      vi.useRealTimers()
      // Tight approval bound so the test doesn't wait 2 h; the normal idle timeout stays longer so it
      // can't be what fires.
      const boundedMgr = createManager({ approvalIdleTimeoutMs: 40 })

      const controlled = controlledStream()
      mockStreamText.mockImplementationOnce(async () => controlled.stream)

      const listener = new FakeListener('l:a')
      startSingle(boundedMgr, {
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request: { ...req('a'), requestOptions: { timeout: 10_000 } },
        listeners: [listener]
      })

      controlled.enqueue({ type: 'start' } as UIMessageChunk)
      controlled.enqueue({ type: 'tool-approval-request', toolCallId: 'tc-1', approvalId: 'a-1' } as UIMessageChunk)

      // No approval response ever arrives (window closed/crashed) → the approval bound fires.
      await new Promise((resolve) => setTimeout(resolve, 120))

      expect(boundedMgr.inspect('a')!.status).toBe('aborted')
    })
  })

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

  // ── mid-stream error chunk ──────────────────────────────────────
  // A provider can emit a terminal `{ type: 'error', errorText }` chunk
  // instead of throwing. `pipeStreamLoop` captures it as `streamErrorText`,
  // and `runExecutionLoop` routes it through `onExecutionError` with the
  // chunk text translated via `errorFromStreamChunk` (name: 'StreamError').

  describe('mid-stream error chunk', () => {
    it('routes a terminal error chunk through onExecutionError with the translated stream error', async () => {
      // readUIMessageStream's accumulator needs real microtask / timer
      // scheduling; fake timers starve its reader loop (see live finalMessage
      // test). The afterEach swaps fake timers back in.
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

      // Provider surfaces a terminal error chunk rather than throwing.
      controlled.enqueue({ type: 'error', errorText: 'boom' } as UIMessageChunk)
      controlled.close()

      // Let the tee → broadcast → terminal chain drain on real timers.
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(listener.errorResults).toHaveLength(1)
      // `errorFromStreamChunk('boom')` → { name: 'StreamError', message: 'boom', stack: null }.
      expect(listener.errorResults[0].error).toEqual({ name: 'StreamError', message: 'boom', stack: null })
      expect(listener.errorResults[0].status).toBe('error')
      expect(mgr.inspect('a')!.status).toBe('error')
    })
  })

  // ── continue-conversation accumulator seed ──────────────────────
  // When the last incoming message is an assistant turn (the tool-approval
  // continue / continue-conversation resume), `runExecutionLoop` seeds
  // `readUIMessageStream` with it (AiStreamManager.ts ~803-805). Without the
  // seed the accumulator's `getToolInvocation` throws on the resumed
  // tool-part ids and silently halts, so `exec.finalMessage` never lands.

  describe('continue-conversation accumulator seed', () => {
    it('seeds the accumulator from a trailing assistant message so finalMessage accumulates', async () => {
      // readUIMessageStream relies on real microtask / timer scheduling.
      vi.useRealTimers()

      const controlled = controlledStream()
      mockStreamText.mockImplementationOnce(async () => controlled.stream)

      // The resumed assistant turn carries a tool part still awaiting its
      // output (input-available). The continuation stream below references
      // that same toolCallId via `tool-output-available`; only the seed lets
      // readUIMessageStream's `getToolInvocation` find the part instead of
      // throwing "No tool invocation found" and halting the accumulator.
      const resumedAssistant = {
        id: 'assistant-resume',
        role: 'assistant',
        parts: [
          {
            type: 'tool-myTool',
            toolCallId: 'tc-1',
            state: 'input-available',
            input: { q: 'x' }
          }
        ]
      } as unknown as CherryUIMessage

      const listener = new FakeListener('l:a')
      const request = { ...req('a'), messages: [resumedAssistant] }
      startSingle(mgr, {
        topicId: 'a',
        modelId: 'provider-a::model-a',
        request,
        listeners: [listener]
      })

      // Continuation: resolve the pre-existing tool call (references the seed's
      // toolCallId), then append text. Without the seed, the tool-output chunk
      // throws inside the accumulator and the later text never accumulates.
      controlled.enqueue({ type: 'start', messageId: 'assistant-resume' } as UIMessageChunk)
      controlled.enqueue({ type: 'tool-output-available', toolCallId: 'tc-1', output: { ok: true } } as UIMessageChunk)
      controlled.enqueue({ type: 'text-start', id: 'p1' } as UIMessageChunk)
      controlled.enqueue({ type: 'text-delta', id: 'p1', delta: 'continued' } as UIMessageChunk)
      controlled.enqueue({ type: 'text-end', id: 'p1' } as UIMessageChunk)
      controlled.enqueue({ type: 'finish' } as UIMessageChunk)
      controlled.close()

      await new Promise((resolve) => setTimeout(resolve, 50))

      const snap = mgr.inspect('a')!
      expect(snap.status).toBe('done')
      // The accumulator did not halt — finalMessage landed with the appended
      // text AND the resolved tool output.
      const parts = (snap.executions[0].finalMessage?.parts ?? []) as Array<{
        type: string
        text?: string
        state?: string
      }>
      expect(parts.some((p) => p.type === 'text' && p.text === 'continued')).toBe(true)
      expect(parts.some((p) => p.type === 'tool-myTool' && p.state === 'output-available')).toBe(true)
    })
  })

  // ── Topic status broadcast ──────────────────────────────────────
  //
  // These tests cover the `topic.stream.statuses.${topicId}` SharedCache
  // entries — Main's `AiStreamManager.broadcastTopicStatus` writes every
  // state transition under the per-topic template key, and the renderer's
  // `useTopicStreamStatus` hook reacts via `useSharedCache`. The
  // assertions inspect the sequence of `setShared` calls per topic to
  // verify both status transitions and `activeExecutions` updates.

  describe('topic status broadcast', () => {
    /** Every value written under `topic.stream.statuses.${topicId}` for the given topic. */
    const statusWritesFor = (topicId: string) =>
      fakeCacheService.setShared.mock.calls
        .filter(([key]) => key === `topic.stream.statuses.${topicId}`)
        .map(
          ([, value]) =>
            value as {
              status: string
              activeExecutions: Array<{ executionId: string; anchorMessageId?: string }>
              lastCompletedAt?: number
            } | null
        )

    /** Status values for a single topic across every write. */
    const statusSequence = (topicId: string): string[] =>
      statusWritesFor(topicId)
        .map((entry) => entry?.status)
        .filter((s): s is string => s !== undefined)

    beforeEach(() => {
      sharedCacheStore.clear()
      fakeCacheService.setShared.mockClear()
      fakeCacheService.getShared.mockClear()
    })

    it('records pending on send, streaming on first chunk, done on terminal; grace-period cleanup is silent', async () => {
      startSingle(mgr, {
        topicId: 't',
        modelId: 'p::m',
        request: req('t'),
        listeners: [new FakeListener('l:t')]
      })
      expect(statusSequence('t')).toEqual(['pending'])

      // First chunk flips pending → streaming.
      mgr.onChunk('t', 'p::m', chunk('hi'))
      expect(statusSequence('t')).toEqual(['pending', 'streaming'])

      // Subsequent chunks do NOT re-write — `onChunk` only transitions on
      // the first chunk (`stream.status === 'pending'` guard).
      mgr.onChunk('t', 'p::m', chunk('ho'))
      expect(statusSequence('t')).toEqual(['pending', 'streaming'])

      await mgr.onExecutionDone('t', 'p::m')
      expect(statusSequence('t')).toEqual(['pending', 'streaming', 'done'])

      // Grace-period cleanup does not write again — the `done` value
      // lingers in SharedCache so renderers can observe the terminal
      // transition; per-window "already animated" is tracked off-schema
      // via `topic.stream.last_seen_completion.*`.
      vi.advanceTimersByTime(31_000)
      expect(statusSequence('t')).toEqual(['pending', 'streaming', 'done'])
    })

    it('sets lastCompletedAt only on done; carries forward through subsequent live; bumps on next done', async () => {
      // First turn: lastCompletedAt unset while pending/streaming, populated on done.
      const baseNow = 1_000_000
      vi.setSystemTime(baseNow)

      startSingle(mgr, {
        topicId: 't',
        modelId: 'p::m',
        request: req('t'),
        listeners: [new FakeListener('l:t')]
      })
      expect(statusWritesFor('t').at(-1)?.lastCompletedAt).toBeUndefined()

      mgr.onChunk('t', 'p::m', chunk('hi'))
      expect(statusWritesFor('t').at(-1)?.lastCompletedAt).toBeUndefined()

      vi.setSystemTime(baseNow + 100)
      await mgr.onExecutionDone('t', 'p::m')
      const firstDone = statusWritesFor('t').at(-1)
      expect(firstDone?.status).toBe('done')
      expect(firstDone?.lastCompletedAt).toBe(baseNow + 100)
      const firstCompletion = firstDone!.lastCompletedAt!

      // Second turn launches before grace-period eviction — the cache entry
      // is the prior 'done', so the new 'pending'/'streaming' broadcasts must
      // carry-forward the prior `lastCompletedAt` (otherwise renderer would
      // think the previous completion was rescinded).
      vi.setSystemTime(baseNow + 200)
      startSingle(mgr, {
        topicId: 't',
        modelId: 'p::m',
        request: req('t'),
        listeners: [new FakeListener('l:t2')]
      })
      expect(statusWritesFor('t').at(-1)?.status).toBe('pending')
      expect(statusWritesFor('t').at(-1)?.lastCompletedAt).toBe(firstCompletion)

      mgr.onChunk('t', 'p::m', chunk('hello again'))
      expect(statusWritesFor('t').at(-1)?.status).toBe('streaming')
      expect(statusWritesFor('t').at(-1)?.lastCompletedAt).toBe(firstCompletion)

      // Second done bumps to a strictly greater timestamp.
      vi.setSystemTime(baseNow + 300)
      await mgr.onExecutionDone('t', 'p::m')
      const secondDone = statusWritesFor('t').at(-1)
      expect(secondDone?.status).toBe('done')
      expect(secondDone?.lastCompletedAt).toBe(baseNow + 300)
      expect(secondDone!.lastCompletedAt!).toBeGreaterThan(firstCompletion)
    })

    it('does not set lastCompletedAt for non-done terminals (aborted, error)', async () => {
      startSingle(mgr, {
        topicId: 't',
        modelId: 'p::m',
        request: req('t'),
        listeners: [new FakeListener('l:t')]
      })
      mgr.abort('t', 'user-stop')
      await vi.runAllTimersAsync()

      const abortedEntry = statusWritesFor('t').at(-1)
      expect(abortedEntry?.status).toBe('aborted')
      expect(abortedEntry?.lastCompletedAt).toBeUndefined()
    })

    it('records aborted when the user stops the stream', async () => {
      startSingle(mgr, {
        topicId: 't',
        modelId: 'p::m',
        request: req('t'),
        listeners: [new FakeListener('l:t')]
      })
      mgr.abort('t', 'user-stop')
      await vi.runAllTimersAsync()

      expect(statusSequence('t')).toEqual(['pending', 'aborted'])
    })

    it('records error when an execution errors before any chunk', async () => {
      startSingle(mgr, {
        topicId: 't',
        modelId: 'p::m',
        request: req('t'),
        listeners: [new FakeListener('l:t')]
      })
      await mgr.onExecutionError('t', 'p::m', error('boom'))

      // pending → error directly; we never fabricate a `streaming` transition
      // when no chunks ever flowed.
      expect(statusSequence('t')).toEqual(['pending', 'error'])
    })

    it('records awaiting-approval when an execution completes paused on a tool-approval-request', async () => {
      startSingle(mgr, {
        topicId: 't',
        modelId: 'p::m',
        request: req('t'),
        listeners: [new FakeListener('l:t')]
      })

      // `tool-approval-request` records the pending toolCallId and flips pending → streaming.
      mgr.onChunk('t', 'p::m', { type: 'tool-approval-request' } as UIMessageChunk)
      expect(statusSequence('t')).toEqual(['pending', 'streaming'])

      // MCP needsApproval ends the stream cleanly via `done`; resolveTerminalStatus
      // overrides the would-be `done` to `awaiting-approval` because the execution
      // is still paused on the approval request.
      await mgr.onExecutionDone('t', 'p::m')
      expect(statusSequence('t')).toEqual(['pending', 'streaming', 'awaiting-approval'])
      expect(mgr.inspect('t')!.status).toBe('awaiting-approval')
    })

    it('clears awaiting-approval when a tool-output chunk resolves the approval before terminal', async () => {
      startSingle(mgr, {
        topicId: 't',
        modelId: 'p::m',
        request: req('t'),
        listeners: [new FakeListener('l:t')]
      })

      // Approval request records the pending toolCallId and flips pending → streaming.
      mgr.onChunk('t', 'p::m', { type: 'tool-approval-request' } as UIMessageChunk)
      expect(statusSequence('t')).toEqual(['pending', 'streaming'])

      // The tool output for the same call clears that toolCallId from the pending set.
      mgr.onChunk('t', 'p::m', { type: 'tool-output-available' } as UIMessageChunk)

      // resolveTerminalStatus no longer finds a paused exec, so the terminal status is `done`,
      // NOT stuck on `awaiting-approval`.
      await mgr.onExecutionDone('t', 'p::m')
      expect(statusSequence('t')).toEqual(['pending', 'streaming', 'done'])
      expect(mgr.inspect('t')!.status).toBe('done')
      expect(mgr.inspect('t')!.status).not.toBe('awaiting-approval')
    })

    it('keeps awaiting-approval when a sibling tool resolves while another approval is still pending', async () => {
      startSingle(mgr, {
        topicId: 't',
        modelId: 'p::m',
        request: req('t'),
        listeners: [new FakeListener('l:t')]
      })

      // One tool is awaiting approval; a parallel tool is still running.
      mgr.onChunk('t', 'p::m', { type: 'tool-approval-request', toolCallId: 'call-approve' } as UIMessageChunk)
      // The sibling's output clears only its own toolCallId — the pending approval must survive
      // (pre-fix this single boolean was cleared by any tool-output and the topic settled to `done`).
      mgr.onChunk('t', 'p::m', { type: 'tool-output-available', toolCallId: 'call-other' } as UIMessageChunk)

      await mgr.onExecutionDone('t', 'p::m')
      expect(mgr.inspect('t')!.status).toBe('awaiting-approval')
    })

    // ── Teardown clears the awaiting-approval flag (no manager-side settle) ──
    //
    // A turn torn down (paused/errored) while a tool is `approval-requested`
    // gets no `tool-output-*` to clear it. The manager only clears the pending-approval
    // set so the status resolves to plain aborted/error and the `awaitingApprovalAnchors`
    // anchor drops; the dangling tool part is terminalized to `output-error` by
    // `finalizeInterruptedParts` (persistence already, re-attach below) — NOT by
    // the manager minting a chunk or rewriting `finalMessage`.

    /** Drive a `tool-approval-request` so the exec is awaiting approval; return the private exec. */
    const startAwaitingApproval = (topicId: string, modelId: UniqueModelId) => {
      mgr.onChunk(topicId, modelId, { type: 'tool-approval-request' } as UIMessageChunk)
      // biome-ignore lint/suspicious/noExplicitAny: reach the private exec to drive the abort path
      return (mgr as any).activeStreams.get(topicId).executions.get(modelId)
    }

    const anchorsOf = (topicId: string) =>
      (sharedCacheStore.get(`topic.stream.statuses.${topicId}`) as { awaitingApprovalAnchors?: unknown[] } | undefined)
        ?.awaitingApprovalAnchors ?? []

    it('onExecutionPaused while awaiting approval clears the flag → status aborted, anchor dropped, no minted chunk', async () => {
      const listener = new FakeListener('l:t')
      startSingle(mgr, { topicId: 't', modelId: 'p::m', request: req('t'), listeners: [listener] })

      const exec = startAwaitingApproval('t', 'p::m')
      exec.status = 'aborted'
      await mgr.onExecutionPaused('t', 'p::m')

      expect(mgr.inspect('t')!.status).toBe('aborted')
      expect(anchorsOf('t')).toEqual([])
      // The manager does not fabricate a settle chunk — finalize owns that.
      expect(listener.chunks.some((c) => c.type === 'tool-output-denied' || c.type === 'tool-output-error')).toBe(false)
    })

    it('onExecutionError while awaiting approval clears the flag → status error, anchor dropped', async () => {
      const listener = new FakeListener('l:t')
      startSingle(mgr, { topicId: 't', modelId: 'p::m', request: req('t'), listeners: [listener] })

      startAwaitingApproval('t', 'p::m')
      await mgr.onExecutionError('t', 'p::m', error('boom'))

      expect(mgr.inspect('t')!.status).toBe('error')
      expect(anchorsOf('t')).toEqual([])
    })

    it('onExecutionDone while awaiting approval keeps awaiting-approval (MCP continue)', async () => {
      const listener = new FakeListener('l:t')
      startSingle(mgr, { topicId: 't', modelId: 'p::m', request: req('t'), listeners: [listener] })

      startAwaitingApproval('t', 'p::m')
      await mgr.onExecutionDone('t', 'p::m')

      expect(mgr.inspect('t')!.status).toBe('awaiting-approval')
      expect(anchorsOf('t')).toHaveLength(1)
    })

    it('multi-model: flips on first chunk from any execution and stays pending if an execution errors before any chunks', async () => {
      mgr.send({
        topicId: 't',
        models: [
          { modelId: 'p::a', request: req('t') },
          { modelId: 'p::b', request: req('t') }
        ],
        listeners: [new FakeListener('l:t')]
      })
      expect(statusSequence('t')).toEqual(['pending'])

      await mgr.onExecutionError('t', 'p::a', error('early'))
      // No spurious transition — topic still pending because B is live.
      expect(statusSequence('t')).toEqual(['pending'])
      expect(mgr.inspect('t')!.status).toBe('pending')

      mgr.onChunk('t', 'p::b', chunk('x'))
      expect(statusSequence('t')).toEqual(['pending', 'streaming'])
    })

    it('carries activeExecutions (with anchor message ids) in every status delta', async () => {
      mgr.send({
        topicId: 't',
        models: [
          { modelId: 'p::a', request: req('t') },
          { modelId: 'p::b', request: req('t') }
        ],
        listeners: [new FakeListener('l:t')]
      })

      const deltas = () =>
        statusWritesFor('t').map((entry) => ({
          status: entry?.status,
          executionIds: entry?.activeExecutions?.map((e) => e.executionId)
        }))

      // On send all executions are launched → both listed as active.
      expect(deltas()).toEqual([{ status: 'pending', executionIds: ['p::a', 'p::b'] }])

      // Per-execution terminals that don't take the topic terminal do NOT
      // re-write (topic still live; `onChunk` is the only path from
      // `pending` → `streaming` that writes).
      await mgr.onExecutionError('t', 'p::a', error('boom'))
      expect(deltas()).toHaveLength(1)

      // First chunk flips topic → 'streaming'. `collectActiveExecutions`
      // filters by `exec.status === 'streaming'`, so p::a (now 'error') is
      // dropped from the list.
      mgr.onChunk('t', 'p::b', chunk('x'))
      expect(deltas().at(-1)).toEqual({ status: 'streaming', executionIds: ['p::b'] })

      // B completes: topic terminal. Since A had errored, topic status is
      // 'error'. All execs are terminal → empty list.
      const deltasBeforeCleanup = deltas().length
      await mgr.onExecutionDone('t', 'p::b')
      expect(deltas().at(-1)).toEqual({ status: 'error', executionIds: [] })

      // Grace-period cleanup is silent.
      vi.advanceTimersByTime(31_000)
      expect(deltas().length).toBe(deltasBeforeCleanup + 1)
    })
  })
})
