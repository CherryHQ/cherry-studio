import i18n from '@renderer/i18n'
import { ChunkType } from '@renderer/types/chunk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AiSdkToChunkAdapter } from '../AiSdkToChunkAdapter'

type ReadResult = { done: boolean; value?: any }

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function createFakeStream(reads: Array<ReturnType<typeof createDeferred<ReadResult>>>) {
  let readIndex = 0
  const reader = {
    read: vi.fn(() => {
      const next = reads[readIndex]
      readIndex += 1
      return next?.promise ?? Promise.resolve({ done: true })
    }),
    releaseLock: vi.fn()
  }

  const stream = {
    getReader: () => reader
  } as any

  return { stream, reader }
}

describe('AiSdkToChunkAdapter idle timeout', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    await i18n.changeLanguage('en-US')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('aborts when no stream events are received within idleTimeoutMs', async () => {
    const idleAbortController = new AbortController()
    const reads = [createDeferred<ReadResult>()]
    const { stream } = createFakeStream(reads)

    const adapter = new AiSdkToChunkAdapter(() => {}, [], false, false, undefined, undefined, {
      idleTimeoutMs: 1000,
      idleAbortController
    })

    const processing = adapter.processStream({ fullStream: stream, text: Promise.resolve('') })

    vi.advanceTimersByTime(1000)
    expect(idleAbortController.signal.aborted).toBe(true)

    reads[0].resolve({ done: true })
    await processing
  })

  it('resets the timer whenever a chunk is received', async () => {
    const idleAbortController = new AbortController()
    const reads = [createDeferred<ReadResult>(), createDeferred<ReadResult>()]
    const { stream } = createFakeStream(reads)

    const adapter = new AiSdkToChunkAdapter(() => {}, [], false, false, undefined, undefined, {
      idleTimeoutMs: 1000,
      idleAbortController
    })

    const processing = adapter.processStream({ fullStream: stream, text: Promise.resolve('') })

    vi.advanceTimersByTime(900)
    expect(idleAbortController.signal.aborted).toBe(false)

    reads[0].resolve({ done: false, value: { type: 'text-delta', text: 'hi' } })
    await Promise.resolve()

    // If the timer wasn't reset, it would have fired at t=1000ms.
    vi.advanceTimersByTime(200)
    expect(idleAbortController.signal.aborted).toBe(false)

    reads[1].resolve({ done: true })
    await processing
  })

  it('cleans up timers when the stream completes', async () => {
    const idleAbortController = new AbortController()
    const reads = [createDeferred<ReadResult>()]
    const { stream } = createFakeStream(reads)

    const adapter = new AiSdkToChunkAdapter(() => {}, [], false, false, undefined, undefined, {
      idleTimeoutMs: 1000,
      idleAbortController
    })

    const processing = adapter.processStream({ fullStream: stream, text: Promise.resolve('') })
    reads[0].resolve({ done: true })
    await processing

    vi.advanceTimersByTime(1000)
    expect(idleAbortController.signal.aborted).toBe(false)
  })

  it('emits a localized TimeoutError when the idle timeout triggers', async () => {
    const chunks: any[] = []
    const idleAbortController = new AbortController()
    const reads = [createDeferred<ReadResult>(), createDeferred<ReadResult>()]
    const { stream } = createFakeStream(reads)

    const adapter = new AiSdkToChunkAdapter((chunk) => chunks.push(chunk), [], false, false, undefined, undefined, {
      idleTimeoutMs: 60_000,
      idleAbortController
    })

    const processing = adapter.processStream({ fullStream: stream, text: Promise.resolve('') })

    vi.advanceTimersByTime(60_000)
    reads[0].resolve({ done: false, value: { type: 'abort' } })
    await Promise.resolve()

    reads[1].resolve({ done: true })
    await processing

    const errorChunk = chunks.find((chunk) => chunk.type === ChunkType.ERROR)
    expect(errorChunk).toBeDefined()
    expect(errorChunk.error?.name).toBe('TimeoutError')
    expect(errorChunk.error?.message).toBe('SSE idle timeout after 1 minutes')
  })
})
