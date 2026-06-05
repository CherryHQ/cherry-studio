import { parseTranslateLangCode } from '@shared/data/preference/preferenceTypes'
import type { TranslateLanguage } from '@shared/data/types/translate'
import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => `t(${key})` })
}))

const translateTextMock =
  vi.fn<
    (
      text: string,
      lang: unknown,
      onResponse?: (text: string, done: boolean) => void,
      signal?: AbortSignal
    ) => Promise<string>
  >()
vi.mock('@renderer/services/TranslateService', () => ({
  translateText: (...args: any[]) => translateTextMock(...(args as Parameters<typeof translateTextMock>))
}))

const formatErrorMessageWithPrefixMock = vi.fn<(err: unknown, prefix: string) => string>(
  (err, prefix) => `${prefix}: ${(err as Error)?.message ?? String(err)}`
)
const isAbortErrorMock = vi.fn<(err: unknown) => boolean>()
vi.mock('@renderer/utils/error', () => ({
  formatErrorMessageWithPrefix: (err: unknown, prefix: string) => formatErrorMessageWithPrefixMock(err, prefix),
  isAbortError: (err: unknown) => isAbortErrorMock(err)
}))

import { useTranslate } from '../useTranslate'

const TARGET = {
  langCode: parseTranslateLangCode('en-us'),
  value: 'English',
  emoji: '🇺🇸',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
} as TranslateLanguage

const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }

// The shared logger mock exposes `error` as a regular method, not a spy.
// Wrap it here so the test can assert call counts.
let loggerErrorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'toast', { value: toast, writable: true, configurable: true })
  isAbortErrorMock.mockReturnValue(false)
  translateTextMock.mockReset()
  loggerErrorSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
})

afterEach(() => {
  loggerErrorSpy.mockRestore()
})

/** Build a translateText impl that resolves on demand so the test can race
 *  cancel/supersede against an in-flight call. */
function pendingTranslateText() {
  let resolve!: (text: string) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<string>((res, rej) => {
    resolve = res
    reject = rej
  })
  translateTextMock.mockImplementationOnce(async () => promise)
  return { resolve, reject }
}

describe('useTranslate', () => {
  describe('happy path', () => {
    it('returns the resolved text and toggles isTranslating around the call', async () => {
      translateTextMock.mockResolvedValueOnce('Hello world')

      const { result } = renderHook(() => useTranslate())

      expect(result.current.isTranslating).toBe(false)

      let translated: string | undefined
      await act(async () => {
        translated = await result.current.translate('源', TARGET)
      })

      expect(translated).toBe('Hello world')
      expect(result.current.isTranslating).toBe(false)
      expect(translateTextMock).toHaveBeenCalledTimes(1)
      expect(toast.error).not.toHaveBeenCalled()
      expect(loggerErrorSpy).not.toHaveBeenCalled()
    })

    it('passes onResponse through to translateText', async () => {
      translateTextMock.mockImplementationOnce(async (_text, _lang, onResponse) => {
        onResponse?.('partial', false)
        onResponse?.('partial done', true)
        return 'partial done'
      })

      const onResponse = vi.fn()
      const { result } = renderHook(() => useTranslate({ onResponse }))

      await act(async () => {
        await result.current.translate('源', TARGET)
      })

      expect(onResponse).toHaveBeenCalledTimes(2)
      expect(onResponse).toHaveBeenNthCalledWith(1, 'partial', false)
      expect(onResponse).toHaveBeenNthCalledWith(2, 'partial done', true)
    })
  })

  describe('AbortSignal pass-through', () => {
    it('passes an unaborted AbortSignal to translateText for each call', async () => {
      translateTextMock.mockResolvedValueOnce('ok')

      const { result } = renderHook(() => useTranslate())

      await act(async () => {
        await result.current.translate('源', TARGET)
      })

      const lastCall = translateTextMock.mock.calls[0]
      const signalArg = lastCall[3]
      expect(signalArg).toBeInstanceOf(AbortSignal)
      expect((signalArg as AbortSignal).aborted).toBe(false)
    })

    it('aborts the signal that was handed to translateText when cancel() fires', () => {
      pendingTranslateText()

      const { result } = renderHook(() => useTranslate())

      act(() => {
        void result.current.translate('源', TARGET)
      })

      const handedSignal = translateTextMock.mock.calls[0][3] as AbortSignal
      expect(handedSignal.aborted).toBe(false)

      act(() => {
        result.current.cancel()
      })

      expect(handedSignal.aborted).toBe(true)
    })

    it('aborts the previous signal when a new translate() supersedes', () => {
      pendingTranslateText()
      translateTextMock.mockResolvedValueOnce('second')

      const { result } = renderHook(() => useTranslate())

      act(() => {
        void result.current.translate('one', TARGET)
      })
      const firstSignal = translateTextMock.mock.calls[0][3] as AbortSignal
      expect(firstSignal.aborted).toBe(false)

      act(() => {
        void result.current.translate('two', TARGET)
      })

      expect(firstSignal.aborted).toBe(true)
      const secondSignal = translateTextMock.mock.calls[1][3] as AbortSignal
      expect(secondSignal.aborted).toBe(false)
    })

    it('aborts the active signal on unmount', () => {
      pendingTranslateText()

      const { result, unmount } = renderHook(() => useTranslate())

      act(() => {
        void result.current.translate('源', TARGET)
      })
      const signal = translateTextMock.mock.calls[0][3] as AbortSignal
      expect(signal.aborted).toBe(false)

      unmount()

      expect(signal.aborted).toBe(true)
    })
  })

  describe('cancel()', () => {
    it('resolves the in-flight translate to undefined and resets isTranslating immediately', async () => {
      const { resolve } = pendingTranslateText()

      const { result } = renderHook(() => useTranslate())

      let translatePromise!: Promise<string | undefined>
      act(() => {
        translatePromise = result.current.translate('源', TARGET)
      })

      // Hook flipped to "in flight" synchronously after translate() invocation.
      expect(result.current.isTranslating).toBe(true)

      act(() => {
        result.current.cancel()
      })

      // cancel() reset state immediately, without waiting for the IPC to drain.
      expect(result.current.isTranslating).toBe(false)

      // The pending IPC eventually resolves — its result is discarded.
      let translated: string | undefined
      await act(async () => {
        resolve('late text that should be ignored')
        translated = await translatePromise
      })

      expect(translated).toBeUndefined()
      expect(toast.error).not.toHaveBeenCalled()
      expect(loggerErrorSpy).not.toHaveBeenCalled()
    })

    it('suppresses a late onResponse callback after cancel()', async () => {
      let onResponseFromService: ((text: string, done: boolean) => void) | undefined
      translateTextMock.mockImplementationOnce(async (_text, _lang, onResponse) => {
        onResponseFromService = onResponse
        return new Promise<string>(() => {
          /* never resolves — test controls timing */
        })
      })

      const onResponse = vi.fn()
      const { result } = renderHook(() => useTranslate({ onResponse }))

      act(() => {
        void result.current.translate('源', TARGET)
      })

      act(() => {
        result.current.cancel()
      })

      // After cancel, onResponse must not propagate to the consumer.
      act(() => {
        onResponseFromService?.('late chunk', true)
      })
      expect(onResponse).not.toHaveBeenCalled()
    })

    it('is a no-op when nothing is in flight', () => {
      const { result } = renderHook(() => useTranslate())
      act(() => {
        result.current.cancel()
      })
      // Nothing observable should change.
      expect(result.current.isTranslating).toBe(false)
    })
  })

  describe('isAbortError handling', () => {
    it('treats an isAbortError as a user-initiated cancel — no toast, no log, returns undefined', async () => {
      const abortError = new Error('aborted')
      isAbortErrorMock.mockImplementation((err) => err === abortError)
      translateTextMock.mockRejectedValueOnce(abortError)

      const { result } = renderHook(() => useTranslate())

      let translated: string | undefined
      await act(async () => {
        translated = await result.current.translate('源', TARGET)
      })

      expect(translated).toBeUndefined()
      expect(toast.error).not.toHaveBeenCalled()
      expect(loggerErrorSpy).not.toHaveBeenCalled()
      expect(result.current.isTranslating).toBe(false)
    })
  })

  describe('non-abort errors', () => {
    it('logs and toasts a prefixed message by default, then returns undefined', async () => {
      const error = new Error('upstream boom')
      translateTextMock.mockRejectedValueOnce(error)

      const { result } = renderHook(() => useTranslate())

      let translated: string | undefined
      await act(async () => {
        translated = await result.current.translate('源', TARGET)
      })

      expect(translated).toBeUndefined()
      expect(loggerErrorSpy).toHaveBeenCalledTimes(1)
      expect(toast.error).toHaveBeenCalledTimes(1)
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('t(translate.error.failed)'))
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('upstream boom'))
      expect(result.current.isTranslating).toBe(false)
    })

    it('honours showErrorToast: false — still logs, skips toast', async () => {
      translateTextMock.mockRejectedValueOnce(new Error('upstream boom'))

      const { result } = renderHook(() => useTranslate({ showErrorToast: false }))

      await act(async () => {
        await result.current.translate('源', TARGET)
      })

      expect(loggerErrorSpy).toHaveBeenCalledTimes(1)
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('honours rethrowError: true — promise rejects with the original error', async () => {
      const error = new Error('upstream boom')
      translateTextMock.mockRejectedValueOnce(error)

      const { result } = renderHook(() => useTranslate({ rethrowError: true }))

      let caught: unknown
      await act(async () => {
        await result.current.translate('源', TARGET).catch((e) => {
          caught = e
        })
      })

      expect(caught).toBe(error)
      expect(result.current.isTranslating).toBe(false)
    })

    it('honours custom errorPrefixI18nKey', async () => {
      translateTextMock.mockRejectedValueOnce(new Error('boom'))

      const { result } = renderHook(() => useTranslate({ errorPrefixI18nKey: 'custom.prefix.key' }))

      await act(async () => {
        await result.current.translate('源', TARGET)
      })

      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('t(custom.prefix.key)'))
    })
  })

  describe('supersede semantics', () => {
    it('a new translate() aborts the previous in-flight call and the previous resolves to undefined', async () => {
      const first = pendingTranslateText()
      translateTextMock.mockResolvedValueOnce('second result')

      const { result } = renderHook(() => useTranslate())

      let firstPromise!: Promise<string | undefined>
      act(() => {
        firstPromise = result.current.translate('one', TARGET)
      })

      let secondTranslated: string | undefined
      await act(async () => {
        secondTranslated = await result.current.translate('two', TARGET)
      })

      // Second call drives the result; first call's pending promise was superseded.
      expect(secondTranslated).toBe('second result')

      // First call's IPC eventually drains; its result must be discarded.
      let firstResolved: string | undefined
      await act(async () => {
        first.resolve('late first result')
        firstResolved = await firstPromise
      })
      expect(firstResolved).toBeUndefined()
    })
  })

  describe('unmount cleanup', () => {
    it('discards a late translateText resolution after unmount', async () => {
      const { resolve } = pendingTranslateText()

      const { result, unmount } = renderHook(() => useTranslate())

      let translatePromise!: Promise<string | undefined>
      act(() => {
        translatePromise = result.current.translate('源', TARGET)
      })

      unmount()

      // After unmount, the still-pending IPC eventually resolves. The hook
      // must drop the result (wasSuperseded) instead of writing into
      // unmounted state.
      let translated: string | undefined
      await act(async () => {
        resolve('late text after unmount')
        translated = await translatePromise
      })

      expect(translated).toBeUndefined()
      expect(toast.error).not.toHaveBeenCalled()
      expect(loggerErrorSpy).not.toHaveBeenCalled()
    })

    it('drops a late onResponse callback after unmount', () => {
      let onResponseFromService: ((text: string, done: boolean) => void) | undefined
      translateTextMock.mockImplementationOnce(async (_text, _lang, onResponse) => {
        onResponseFromService = onResponse
        return new Promise<string>(() => {
          /* never resolves — test controls timing */
        })
      })

      const onResponse = vi.fn()
      const { result, unmount } = renderHook(() => useTranslate({ onResponse }))

      act(() => {
        void result.current.translate('源', TARGET)
      })

      unmount()

      onResponseFromService?.('late chunk after unmount', true)
      expect(onResponse).not.toHaveBeenCalled()
    })
  })
})
