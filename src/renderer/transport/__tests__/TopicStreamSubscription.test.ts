import type { StreamChunkPayload } from '@shared/ai/transport'
import type { UniqueModelId } from '@shared/data/types/model'
import type { UIMessageChunk } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TopicStreamSubscription } from '../TopicStreamSubscription'

// Reuse the established window.api.ai mock shape (see IpcChatTransport.test.ts).
function createMockAiApi() {
  const listeners = {
    chunk: [] as Array<(d: StreamChunkPayload) => void>,
    done: [] as Array<
      (d: { topicId: string; executionId?: UniqueModelId; status: string; isTopicDone?: boolean }) => void
    >,
    error: [] as Array<
      (d: { topicId: string; executionId?: UniqueModelId; isTopicDone?: boolean; error: unknown }) => void
    >
  }
  const mockApi = {
    streamOpen: vi.fn().mockResolvedValue({ mode: 'started' }),
    streamAttach: vi.fn().mockResolvedValue({ status: 'attached', bufferedChunks: [] }),
    streamDetach: vi.fn().mockResolvedValue(undefined),
    streamAbort: vi.fn().mockResolvedValue(undefined),
    onStreamChunk: vi.fn((cb) => {
      listeners.chunk.push(cb)
      return () => listeners.chunk.splice(listeners.chunk.indexOf(cb) >>> 0, 1)
    }),
    onStreamDone: vi.fn((cb) => {
      listeners.done.push(cb)
      return () => listeners.done.splice(listeners.done.indexOf(cb) >>> 0, 1)
    }),
    onStreamError: vi.fn((cb) => {
      listeners.error.push(cb)
      return () => listeners.error.splice(listeners.error.indexOf(cb) >>> 0, 1)
    })
  }
  return {
    mockApi,
    emitChunk: (topicId: string, executionId: UniqueModelId, chunk: UIMessageChunk) => {
      for (const cb of [...listeners.chunk]) cb({ topicId, executionId, chunk })
    },
    emitDone: (
      topicId: string,
      executionId: UniqueModelId | undefined,
      status: 'success' | 'paused',
      isTopicDone?: boolean
    ) => {
      for (const cb of [...listeners.done]) cb({ topicId, executionId, status, isTopicDone })
    }
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0))
const textChunk = (delta: string): UIMessageChunk => ({ type: 'text-delta', id: 't', delta }) as UIMessageChunk

async function readAll(stream: ReadableStream<UIMessageChunk>): Promise<UIMessageChunk[]> {
  const reader = stream.getReader()
  const out: UIMessageChunk[] = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      out.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return out
}

const TOPIC = 'topic-1'
const A = 'openai::gpt-4o' as UniqueModelId
const B = 'anthropic::claude' as UniqueModelId

describe('TopicStreamSubscription', () => {
  let mock: ReturnType<typeof createMockAiApi>
  let originalApi: unknown

  beforeEach(() => {
    mock = createMockAiApi()
    originalApi = (window as unknown as { api: unknown }).api
    ;(window as unknown as { api: unknown }).api = { ...(originalApi as object), ai: mock.mockApi }
  })
  afterEach(() => {
    ;(window as unknown as { api: unknown }).api = originalApi
  })

  it('attaches once for the topic regardless of how many executions register', async () => {
    const sub = new TopicStreamSubscription(TOPIC)
    sub.register(A)
    sub.register(B)
    await tick()
    expect(mock.mockApi.streamAttach).toHaveBeenCalledTimes(1)
    expect(mock.mockApi.streamAttach).toHaveBeenCalledWith({ topicId: TOPIC })
    sub.dispose()
  })

  it('demuxes chunks to the correct branch by executionId; no cross-contamination', async () => {
    const sub = new TopicStreamSubscription(TOPIC)
    const sa = sub.register(A)
    const sb = sub.register(B)
    await tick()

    mock.emitChunk(TOPIC, A, textChunk('helloA'))
    mock.emitChunk(TOPIC, B, textChunk('helloB'))
    mock.emitDone(TOPIC, A, 'success')
    mock.emitDone(TOPIC, B, 'success')

    const [ca, cb] = await Promise.all([readAll(sa), readAll(sb)])
    expect(ca).toEqual([textChunk('helloA')])
    expect(cb).toEqual([textChunk('helloB')])
    sub.dispose()
  })

  it('buffers chunks that arrive before a reader drains (internal queue)', async () => {
    const sub = new TopicStreamSubscription(TOPIC)
    const sa = sub.register(A)
    await tick()
    mock.emitChunk(TOPIC, A, textChunk('one'))
    mock.emitChunk(TOPIC, A, textChunk('two'))
    mock.emitDone(TOPIC, A, 'success')
    expect(await readAll(sa)).toEqual([textChunk('one'), textChunk('two')])
    sub.dispose()
  })

  it('one execution ending does NOT detach the topic or affect the other branch', async () => {
    const sub = new TopicStreamSubscription(TOPIC)
    const sa = sub.register(A)
    const sb = sub.register(B)
    await tick()

    mock.emitChunk(TOPIC, A, textChunk('a1'))
    mock.emitDone(TOPIC, A, 'success')
    sub.unregister(A)
    await tick()

    expect(mock.mockApi.streamDetach).not.toHaveBeenCalled()

    // B keeps flowing after A is gone.
    mock.emitChunk(TOPIC, B, textChunk('b1'))
    mock.emitChunk(TOPIC, B, textChunk('b2'))
    mock.emitDone(TOPIC, B, 'success', true)
    expect(await readAll(sb)).toEqual([textChunk('b1'), textChunk('b2')])
    expect(await readAll(sa)).toEqual([textChunk('a1')])
    sub.dispose()
  })

  it('detaches the topic exactly once when the LAST execution unregisters', async () => {
    const sub = new TopicStreamSubscription(TOPIC)
    sub.register(A)
    sub.register(B)
    await tick()

    sub.unregister(A)
    await tick()
    expect(mock.mockApi.streamDetach).not.toHaveBeenCalled()

    sub.unregister(B)
    await tick()
    expect(mock.mockApi.streamDetach).toHaveBeenCalledTimes(1)
    expect(mock.mockApi.streamDetach).toHaveBeenCalledWith({ topicId: TOPIC })
    sub.dispose()
  })

  it('detaches once attach resolves when the execution unregistered while attach was in flight', async () => {
    // Hold streamAttach open so register→unregister both happen before it resolves.
    let resolveAttach!: (res: { status: 'attached'; bufferedChunks: StreamChunkPayload[] }) => void
    mock.mockApi.streamAttach.mockImplementationOnce(
      () =>
        new Promise<{ status: 'attached'; bufferedChunks: StreamChunkPayload[] }>((resolve) => {
          resolveAttach = resolve
        })
    )

    const sub = new TopicStreamSubscription(TOPIC)
    sub.register(A)
    sub.unregister(A) // last execution gone, but #attached is still false → deferred-detach guard skips
    await tick()
    expect(mock.mockApi.streamDetach).not.toHaveBeenCalled()

    // Resolving attach must detach once, with no branches left to keep Main's listener.
    resolveAttach({ status: 'attached', bufferedChunks: [] })
    await tick()
    expect(mock.mockApi.streamDetach).toHaveBeenCalledTimes(1)
    expect(mock.mockApi.streamDetach).toHaveBeenCalledWith({ topicId: TOPIC })
    sub.dispose()
  })

  it('never detaches when the last execution is replaced by a new one within the same microtask', async () => {
    const sub = new TopicStreamSubscription(TOPIC)
    sub.register(A)
    await tick() // attach resolves → #attached === true

    // Unregister the last execution and immediately re-register a new one,
    // synchronously, before the deferred-detach microtask runs.
    sub.unregister(A)
    sub.register(B)
    await tick()

    expect(mock.mockApi.streamDetach).not.toHaveBeenCalled()
    expect(mock.mockApi.streamAttach).toHaveBeenCalledTimes(1) // still the same attach
    sub.dispose()
  })

  it('demuxes attach-replay bufferedChunks by executionId', async () => {
    mock.mockApi.streamAttach.mockResolvedValueOnce({
      status: 'attached',
      bufferedChunks: [
        { topicId: TOPIC, executionId: A, chunk: textChunk('replayA') },
        { topicId: TOPIC, executionId: B, chunk: textChunk('replayB') }
      ] satisfies StreamChunkPayload[]
    })
    const sub = new TopicStreamSubscription(TOPIC)
    const sa = sub.register(A)
    const sb = sub.register(B)
    await tick()
    mock.emitDone(TOPIC, undefined, 'success', true)
    expect(await readAll(sa)).toEqual([textChunk('replayA')])
    expect(await readAll(sb)).toEqual([textChunk('replayB')])
    sub.dispose()
  })

  it('per-execution onStreamDone closes that branch and fires a terminal event', async () => {
    const sub = new TopicStreamSubscription(TOPIC)
    const sa = sub.register(A)
    const terminals: Array<{ id: string; isAbort: boolean; isError: boolean }> = []
    sub.onExecutionTerminal((id, t) => terminals.push({ id, ...t }))
    await tick()

    mock.emitChunk(TOPIC, A, textChunk('x'))
    mock.emitDone(TOPIC, A, 'paused')
    expect(await readAll(sa)).toEqual([textChunk('x')]) // stream closed → read ends
    expect(terminals).toEqual([{ id: A, isAbort: true, isError: false }])
    sub.dispose()
  })

  it('dispose() detaches, drops IPC listeners and closes branches', async () => {
    const sub = new TopicStreamSubscription(TOPIC)
    const sa = sub.register(A)
    await tick()
    sub.dispose()
    expect(mock.mockApi.streamDetach).toHaveBeenCalledTimes(1)
    expect(await readAll(sa)).toEqual([]) // closed by dispose
    // listeners removed: emitting after dispose is a no-op (no throw)
    mock.emitChunk(TOPIC, A, textChunk('late'))
  })

  it('attach not-found closes branches so readers end immediately', async () => {
    mock.mockApi.streamAttach.mockResolvedValueOnce({ status: 'not-found' })
    const sub = new TopicStreamSubscription(TOPIC)
    const sa = sub.register(A)
    await tick()
    expect(await readAll(sa)).toEqual([])
    sub.dispose()
  })
})
