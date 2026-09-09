import { useTranslate } from '@renderer/hooks/translate/useTranslate'
import { toast } from '@renderer/services/toast'
import { isAbortError } from '@renderer/utils/error'
import { parseTranslateLangCode } from '@shared/data/preference/preferenceTypes'
import type { TranslateLanguage } from '@shared/data/types/translate'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('i18next', () => ({
  t: (key: string) => `t(${key})`
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => `t(${key})` })
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
 *   6. Abort via the `ai.stream.abort` route keyed on `streamId`
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
      case 'ai.stream.abort':
        return ai.streamAbort(input)
      default:
        return Promise.resolve(undefined)
    }
  })
  const on = (event: string, cb: (p: unknown) => void): (() => void) => {
    switch (event) {
      case 'ai.stream.chunk':
        return ai.onStreamChunk(cb as never)
      case 'ai.stream.done':
        return ai.onStreamDone(cb as never)
      case 'ai.stream.error':
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
      const openCallOrder = mockRequest.mock.invocationCallOrder[0]
      for (const subscribe of [mockAi.onStreamChunk, mockAi.onStreamDone, mockAi.onStreamError]) {
        expect(subscribe.mock.invocationCallOrder[0]).toBeLessThan(openCallOrder)
      }

      const streamId = lastStreamId(mockRequest)
      emitChunk(mockListeners, 'Hello ', streamId)
      emitChunk(mockListeners, 'world', streamId)
      emitDone(mockListeners, streamId)

      await expect(promise).resolves.toBe('Hello world')
      expect(mockListeners).toEqual({ chunk: [], done: [], error: [] })
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
    it.each([
      ['a string', parseTranslateLangCode('en-us'), 'en-us'],
      ['a DTO', TARGET, TARGET.langCode]
    ] as const)('forwards the normalized lang code when given %s', async (_kind, targetLanguage, expectedLangCode) => {
      const promise = translateText('source', targetLanguage)
      await waitForOpen(mockRequest)
      const streamId = lastStreamId(mockRequest)
      emitChunk(mockListeners, 'ok', streamId)
      emitDone(mockListeners, streamId)
      await promise

      expect(mockRequest).toHaveBeenCalledWith('translate.open', {
        streamId: expect.stringMatching(/^translate:/),
        text: 'source',
        targetLangCode: expectedLangCode
      })
    })

    it.each([
      ['an invalid code', 'not-a-real-code'],
      ['the unknown sentinel', 'unknown']
    ])('rejects %s without calling main', async (_kind, targetLanguage) => {
      await expect(translateText('source', targetLanguage as any)).rejects.toThrow(
        `Invalid target language: ${targetLanguage}`
      )
      expect(mockRequest).not.toHaveBeenCalledWith('translate.open', expect.anything())
    })
  })

  describe('main-side failure', () => {
    it('rejects with the main error when translate.open throws (e.g. not configured)', async () => {
      mockTranslateOpen.mockRejectedValueOnce(new Error('t(translate.error.not_configured)'))
      await expect(translateText('source', TARGET)).rejects.toThrow('t(translate.error.not_configured)')
      expect(mockListeners).toEqual({ chunk: [], done: [], error: [] })
    })
  })

  describe('empty output', () => {
    it.each([
      ['no chunks arrive', undefined],
      ['the accumulated text is whitespace only', '   \n  ']
    ])('rejects with translate.error.empty when %s', async (_kind, delta) => {
      const promise = translateText('source', TARGET)
      await waitForOpen(mockRequest)
      const streamId = lastStreamId(mockRequest)
      if (delta !== undefined) emitChunk(mockListeners, delta, streamId)
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
      expect(mockListeners).toEqual({ chunk: [], done: [], error: [] })
    })

    it('preserves AbortError name so callers can classify user-initiated cancels', async () => {
      const promise = translateText('source', TARGET)
      await waitForOpen(mockRequest)
      emitError(mockListeners, { name: 'AbortError', message: 'stopped by user' }, lastStreamId(mockRequest))

      const err = await promise.catch((e) => e)
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).name).toBe('AbortError')
      expect(isAbortError(err)).toBe(true)
    })

    it('silently completes an active translation for a serialized AbortError', async () => {
      const { result } = renderHook(() => useTranslate({ rethrowError: true }))
      let pending!: Promise<string | undefined>
      act(() => {
        pending = result.current.translate('source', TARGET)
      })
      const outcome = pending.then(
        (value) => ({ value }),
        (error) => ({ error })
      )
      await waitForOpen(mockRequest)

      await act(async () => {
        emitError(mockListeners, { name: 'AbortError', message: 'stopped by user' }, lastStreamId(mockRequest))
        expect(await outcome).toEqual({ value: undefined })
      })
      expect(result.current.isTranslating).toBe(false)
      expect(toast.error).not.toHaveBeenCalled()
    })
  })

  describe('abort signal', () => {
    it('requests abort but waits for the terminal stream event before rejecting', async () => {
      const controller = new AbortController()
      const promise = translateText('source', TARGET, undefined, controller.signal)
      let settled = false
      const outcome = promise.then(
        (value) => {
          settled = true
          return value
        },
        (error: unknown) => {
          settled = true
          return error
        }
      )
      await waitForOpen(mockRequest)
      const streamId = lastStreamId(mockRequest)

      emitChunk(mockListeners, 'partial', streamId)
      controller.abort()
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(settled).toBe(false)
      expect(mockAi.streamAbort).toHaveBeenCalledWith({ topicId: streamId })

      emitError(mockListeners, { name: 'AbortError', message: 'aborted' }, streamId)
      expect(await outcome).toMatchObject({ name: 'AbortError', message: 'aborted' })
      expect(mockListeners).toEqual({ chunk: [], done: [], error: [] })
    })

    it.each(['done', 'error', 'open failure'] as const)('detaches the abort callback after %s', async (terminal) => {
      const controller = new AbortController()
      if (terminal === 'open failure') mockTranslateOpen.mockRejectedValueOnce(new Error('cannot open'))
      const promise = translateText('source', TARGET, undefined, controller.signal)
      const outcome = promise.catch((error: unknown) => error)
      await waitForOpen(mockRequest)
      const streamId = lastStreamId(mockRequest)

      if (terminal === 'done') {
        emitChunk(mockListeners, 'complete', streamId)
        emitDone(mockListeners, streamId)
        expect(await outcome).toBe('complete')
      } else if (terminal === 'error') {
        emitError(mockListeners, { name: 'Error', message: 'stream failed' }, streamId)
        expect(await outcome).toMatchObject({ message: 'stream failed' })
      } else {
        expect(await outcome).toMatchObject({ message: 'cannot open' })
      }

      controller.abort()
      expect(mockAi.streamAbort).not.toHaveBeenCalled()
      expect(mockListeners).toEqual({ chunk: [], done: [], error: [] })
    })

    it('rejects synchronously when the supplied signal is already aborted', async () => {
      const controller = new AbortController()
      controller.abort()

      await expect(translateText('source', TARGET, undefined, controller.signal)).rejects.toThrow()
      expect(mockRequest).not.toHaveBeenCalledWith('translate.open', expect.anything())
    })
  })
})
