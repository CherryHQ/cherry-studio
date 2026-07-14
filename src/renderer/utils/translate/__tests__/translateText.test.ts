import { parseTranslateLangCode } from '@shared/data/preference/preferenceTypes'
import type { TranslateLanguage } from '@shared/data/types/translate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('i18next', () => ({
  t: (key: string) => `t(${key})`
}))

// AI stream calls go through ipcApi.request('ai.stream_*') / ipcApi.on('ai.stream_*') and
// `translate.open` now goes through ipcApi.request('translate.open', …). `ipcMock` is re-pointed
// at the fresh per-test mock in beforeEach.
const { ipcMock } = vi.hoisted(() => ({
  ipcMock: {
    request: (() => undefined) as (route: string, input: unknown) => unknown,
    on: (() => () => {}) as (event: string, cb: (p: unknown) => void) => () => void
  }
}))
vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: (route: string, input: unknown) => ipcMock.request(route, input),
    on: (event: string, cb: (p: unknown) => void) => ipcMock.on(event, cb)
  }
}))

import { translateText } from '../translateText'

/**
 * `translateText` is a thin renderer bridge over the main translate IPC.
 *
 * Flow under test:
 *   1. Normalise the target language (DTO → langCode) and validate
 *   2. Generate a `translate:`-prefixed `streamId`
 *   3. Subscribe to `onStreamChunk` / `onStreamDone` / `onStreamError` BEFORE
 *      invoking main (so the first chunk cannot race past the listener)
 *   4. Call `ipcApi.request('translate.open', { streamId, text, targetLangCode })`
 *   5. Accumulate text-delta chunks, fire `onResponse`, resolve trimmed
 *      final text on done
 *   6. Abort via the `ai.stream_abort` route keyed on `streamId`
 */

const TARGET = {
  langCode: parseTranslateLangCode('en-us'),
  value: 'English',
  emoji: '🇺🇸',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
} as TranslateLanguage

interface MockAiApi {
  streamAbort: ReturnType<typeof vi.fn>
  onStreamChunk: ReturnType<typeof vi.fn>
  onStreamDone: ReturnType<typeof vi.fn>
  onStreamError: ReturnType<typeof vi.fn>
}

interface MockListeners {
  chunk: Array<(data: { topicId: string; chunk: unknown }) => void>
  done: Array<(data: { topicId: string }) => void>
  error: Array<(data: { topicId: string; error?: { name?: string; message?: string } }) => void>
}

function createMocks(): {
  ai: MockAiApi
  translateOpen: ReturnType<typeof vi.fn>
  listeners: MockListeners
  request: ReturnType<typeof vi.fn>
  on: (event: string, cb: (p: unknown) => void) => () => void
} {
  const listeners: MockListeners = { chunk: [], done: [], error: [] }
  const ai: MockAiApi = {
    streamAbort: vi.fn().mockResolvedValue(undefined),
    onStreamChunk: vi.fn((cb: (data: { topicId: string; chunk: unknown }) => void) => {
      listeners.chunk.push(cb)
      return () => {
        const i = listeners.chunk.indexOf(cb)
        if (i >= 0) listeners.chunk.splice(i, 1)
      }
    }),
    onStreamDone: vi.fn((cb: (data: { topicId: string }) => void) => {
      listeners.done.push(cb)
      return () => {
        const i = listeners.done.indexOf(cb)
        if (i >= 0) listeners.done.splice(i, 1)
      }
    }),
    onStreamError: vi.fn((cb: (data: { topicId: string; error?: { name?: string; message?: string } }) => void) => {
      listeners.error.push(cb)
      return () => {
        const i = listeners.error.indexOf(cb)
        if (i >= 0) listeners.error.splice(i, 1)
      }
    })
  }
  // `translate.open` behaviour — renderer generates `streamId`, echo it back so
  // emit helpers can use it. Exposed separately so failure tests can override it.
  const translateOpen = vi.fn(async ({ streamId }: { streamId: string }) => ({ streamId }))
  // ipcApi.request dispatcher wired to the spies above.
  const request = vi.fn((route: string, input: unknown): unknown => {
    switch (route) {
      case 'translate.open':
        return translateOpen(input as { streamId: string })
      case 'ai.stream_abort':
        return ai.streamAbort(input)
      default:
        return Promise.resolve(undefined)
    }
  })
  const on = (event: string, cb: (p: unknown) => void): (() => void) => {
    switch (event) {
      case 'ai.stream_chunk':
        return ai.onStreamChunk(cb as never)
      case 'ai.stream_done':
        return ai.onStreamDone(cb as never)
      case 'ai.stream_error':
        return ai.onStreamError(cb as never)
      default:
        return () => {}
    }
  }
  return { ai, translateOpen, listeners, request, on }
}

/** Pull the renderer-generated streamId from the latest `ipcApi.request('translate.open', …)` call. */
function lastStreamId(request: ReturnType<typeof vi.fn>): string {
  const calls = request.mock.calls.filter(([route]) => route === 'translate.open')
  if (calls.length === 0) throw new Error("ipcApi.request('translate.open', …) has not been called yet")
  return (calls[calls.length - 1][1] as { streamId: string }).streamId
}

function emitChunk(listeners: MockListeners, delta: string, topicId: string) {
  for (const cb of [...listeners.chunk]) {
    cb({ topicId, chunk: { type: 'text-delta', id: 't1', delta } })
  }
}

function emitDone(listeners: MockListeners, topicId: string) {
  for (const cb of [...listeners.done]) cb({ topicId })
}

function emitError(listeners: MockListeners, error: { name?: string; message: string }, topicId: string) {
  for (const cb of [...listeners.error]) cb({ topicId, error })
}

/** Wait until `translate.open` has resolved — guarantees subscribers are wired. */
async function waitForOpen(request: ReturnType<typeof vi.fn>) {
  await vi.waitFor(() => expect(request).toHaveBeenCalledWith('translate.open', expect.anything()))
  // Microtask flush so the await on `open()` returns and listeners register.
  await Promise.resolve()
  await Promise.resolve()
}

let mockAi: MockAiApi
let mockRequest: ReturnType<typeof vi.fn>
let mockTranslateOpen: ReturnType<typeof vi.fn>
let mockListeners: MockListeners

beforeEach(() => {
  const m = createMocks()
  mockAi = m.ai
  mockRequest = m.request
  mockTranslateOpen = m.translateOpen
  mockListeners = m.listeners
  ipcMock.request = m.request
  ipcMock.on = m.on
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('translateText (main-driven streaming)', () => {
  describe('happy path', () => {
    it('passes a translate:-prefixed streamId + text + langCode to main and accumulates chunks', async () => {
      const promise = translateText('source', TARGET)
      await waitForOpen(mockRequest)

      expect(mockRequest).toHaveBeenCalledWith('translate.open', {
        streamId: expect.stringMatching(/^translate:/),
        text: 'source',
        targetLangCode: 'en-us'
      })

      const streamId = lastStreamId(mockRequest)
      emitChunk(mockListeners, 'Hello ', streamId)
      emitChunk(mockListeners, 'world', streamId)
      emitDone(mockListeners, streamId)

      await expect(promise).resolves.toBe('Hello world')
    })

    it('trims trailing whitespace from the final accumulated text', async () => {
      const promise = translateText('source', TARGET)
      await waitForOpen(mockRequest)
      const streamId = lastStreamId(mockRequest)

      emitChunk(mockListeners, '  Hello  ', streamId)
      emitDone(mockListeners, streamId)

      await expect(promise).resolves.toBe('Hello')
    })

    it('invokes onResponse per chunk and once with isComplete=true on done', async () => {
      const onResponse = vi.fn()
      const promise = translateText('source', TARGET, onResponse)
      await waitForOpen(mockRequest)
      const streamId = lastStreamId(mockRequest)

      emitChunk(mockListeners, 'Hi', streamId)
      emitChunk(mockListeners, ' there', streamId)
      emitDone(mockListeners, streamId)

      await promise

      expect(onResponse).toHaveBeenCalledTimes(3)
      expect(onResponse).toHaveBeenNthCalledWith(1, 'Hi', false)
      expect(onResponse).toHaveBeenNthCalledWith(2, 'Hi there', false)
      expect(onResponse).toHaveBeenNthCalledWith(3, 'Hi there', true)
    })

    it('ignores chunks routed to a different streamId', async () => {
      const onResponse = vi.fn()
      const promise = translateText('source', TARGET, onResponse)
      await waitForOpen(mockRequest)
      const streamId = lastStreamId(mockRequest)

      emitChunk(mockListeners, 'unrelated', 'other-stream')
      emitChunk(mockListeners, 'mine', streamId)
      emitDone(mockListeners, streamId)

      await expect(promise).resolves.toBe('mine')
      expect(onResponse).toHaveBeenCalledTimes(2)
      expect(onResponse).toHaveBeenNthCalledWith(1, 'mine', false)
    })
  })

  describe('target language normalisation', () => {
    it('forwards the lang code to main when given a string', async () => {
      const promise = translateText('source', parseTranslateLangCode('en-us'))
      await waitForOpen(mockRequest)
      const streamId = lastStreamId(mockRequest)
      emitChunk(mockListeners, 'ok', streamId)
      emitDone(mockListeners, streamId)
      await promise

      expect(mockRequest).toHaveBeenCalledWith('translate.open', {
        streamId: expect.stringMatching(/^translate:/),
        text: 'source',
        targetLangCode: 'en-us'
      })
    })

    it('extracts the lang code from a DTO before calling main', async () => {
      const promise = translateText('source', TARGET)
      await waitForOpen(mockRequest)
      const streamId = lastStreamId(mockRequest)
      emitChunk(mockListeners, 'ok', streamId)
      emitDone(mockListeners, streamId)
      await promise

      expect(mockRequest).toHaveBeenCalledWith('translate.open', {
        streamId: expect.stringMatching(/^translate:/),
        text: 'source',
        targetLangCode: TARGET.langCode
      })
    })

    it('throws when given an invalid string langCode without calling main', async () => {
      await expect(translateText('source', 'not-a-real-code' as any)).rejects.toThrow(
        'Invalid target language: not-a-real-code'
      )
      expect(mockRequest).not.toHaveBeenCalledWith('translate.open', expect.anything())
    })

    it('throws when given the "unknown" sentinel', async () => {
      await expect(translateText('source', 'unknown' as any)).rejects.toThrow('Invalid target language: unknown')
      expect(mockRequest).not.toHaveBeenCalledWith('translate.open', expect.anything())
    })
  })

  describe('main-side failure', () => {
    it('rejects with the main error when translate.open throws (e.g. not configured)', async () => {
      mockTranslateOpen.mockRejectedValueOnce(new Error('t(translate.error.not_configured)'))
      await expect(translateText('source', TARGET)).rejects.toThrow('t(translate.error.not_configured)')
    })
  })

  describe('empty output', () => {
    it('rejects with translate.error.empty when no chunks arrive before done', async () => {
      const promise = translateText('source', TARGET)
      await waitForOpen(mockRequest)
      emitDone(mockListeners, lastStreamId(mockRequest))
      await expect(promise).rejects.toThrow('t(translate.error.empty)')
    })

    it('rejects with translate.error.empty when accumulated text is whitespace only', async () => {
      const promise = translateText('source', TARGET)
      await waitForOpen(mockRequest)
      const streamId = lastStreamId(mockRequest)
      emitChunk(mockListeners, '   \n  ', streamId)
      emitDone(mockListeners, streamId)
      await expect(promise).rejects.toThrow('t(translate.error.empty)')
    })
  })

  describe('stream errors', () => {
    it('rejects with the upstream error message', async () => {
      const promise = translateText('source', TARGET)
      await waitForOpen(mockRequest)
      emitError(mockListeners, { name: 'Error', message: 'upstream boom' }, lastStreamId(mockRequest))

      await expect(promise).rejects.toThrow('upstream boom')
    })

    it('preserves AbortError name so callers can classify user-initiated cancels', async () => {
      const promise = translateText('source', TARGET)
      await waitForOpen(mockRequest)
      emitError(mockListeners, { name: 'AbortError', message: 'stopped by user' }, lastStreamId(mockRequest))

      const err = await promise.catch((e) => e)
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).name).toBe('AbortError')
    })
  })

  describe('abort signal', () => {
    it('calls streamAbort with the streamId when the signal fires mid-stream', async () => {
      const controller = new AbortController()
      const promise = translateText('source', TARGET, undefined, controller.signal)
      await waitForOpen(mockRequest)
      const streamId = lastStreamId(mockRequest)

      emitChunk(mockListeners, 'partial', streamId)
      controller.abort()
      // Main would emit an abort-shaped error in response; simulate it here so
      // the function's reject path completes.
      emitError(mockListeners, { name: 'AbortError', message: 'aborted' }, streamId)

      await promise.catch(() => undefined)

      expect(mockAi.streamAbort).toHaveBeenCalledWith({ topicId: streamId })
    })

    it('rejects synchronously when the supplied signal is already aborted', async () => {
      const controller = new AbortController()
      controller.abort()

      await expect(translateText('source', TARGET, undefined, controller.signal)).rejects.toThrow()
      expect(mockRequest).not.toHaveBeenCalledWith('translate.open', expect.anything())
    })
  })
})
