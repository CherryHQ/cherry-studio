import { parseTranslateLangCode } from '@shared/data/preference/preferenceTypes'
import type { TranslateLanguage } from '@shared/data/types/translate'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
vi.mock('@renderer/utils/translate/translateText', () => ({
  translateText: (...args: any[]) => translateTextMock(...(args as Parameters<typeof translateTextMock>))
}))

vi.mock('@renderer/utils/error', () => ({
  formatErrorMessageWithPrefix: (err: unknown, prefix: string) => `${prefix}: ${String(err)}`,
  isAbortError: (err: unknown) => (err as Error)?.name === 'AbortError'
}))

import { tabSessionRegistry } from '@renderer/services/TabSessionRegistry'

import { useTranslate } from '../useTranslate'

const TARGET = {
  langCode: parseTranslateLangCode('en-us'),
  value: 'English',
  emoji: '🇺🇸',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
} as TranslateLanguage

/** A translateText that never settles on its own, so a run can be observed mid-flight. */
function pendingTranslateText() {
  let signal: AbortSignal | undefined
  translateTextMock.mockImplementationOnce(
    (_text, _lang, _onResponse, abortSignal) =>
      new Promise<string>((_resolve, reject) => {
        signal = abortSignal
        abortSignal?.addEventListener('abort', () => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        })
      })
  )
  return { getSignal: () => signal }
}

let sessionSeq = 0
const newSessionId = () => `session-${(sessionSeq += 1)}`

beforeEach(() => {
  vi.clearAllMocks()
  translateTextMock.mockReset()
})

describe('useTranslate with a tab session', () => {
  it('keeps the run alive when the page unmounts', async () => {
    // #18885: switching tabs unmounts the page under `Activity`; the run must not be cancelled.
    const { getSignal } = pendingTranslateText()
    const session = tabSessionRegistry.getOrCreate(newSessionId(), () => true)
    const { result, unmount } = renderHook(() => useTranslate({ session }))

    act(() => {
      void result.current.translate('source', TARGET)
    })
    expect(session.isBusy()).toBe(true)

    unmount()

    expect(getSignal()?.aborted).toBe(false)
    expect(session.isBusy()).toBe(true)
  })

  it('still reports isTranslating to a page that remounted mid-run', async () => {
    pendingTranslateText()
    const session = tabSessionRegistry.getOrCreate(newSessionId(), () => true)
    const first = renderHook(() => useTranslate({ session }))

    act(() => {
      void first.result.current.translate('source', TARGET)
    })
    first.unmount()

    const second = renderHook(() => useTranslate({ session }))

    expect(second.result.current.isTranslating).toBe(true)
  })

  it('lets a remounted page cancel a run it never started', async () => {
    // The Stop button after a tab switch — this mount holds no controller of its own.
    const { getSignal } = pendingTranslateText()
    const session = tabSessionRegistry.getOrCreate(newSessionId(), () => true)
    const first = renderHook(() => useTranslate({ session }))

    act(() => {
      void first.result.current.translate('source', TARGET)
    })
    first.unmount()

    const second = renderHook(() => useTranslate({ session }))
    act(() => {
      second.result.current.cancel()
    })

    expect(getSignal()?.aborted).toBe(true)
    expect(second.result.current.isTranslating).toBe(false)
  })

  it('aborts the run when the session is released', async () => {
    const { getSignal } = pendingTranslateText()
    const id = newSessionId()
    const session = tabSessionRegistry.getOrCreate(id, () => true)
    const { result } = renderHook(() => useTranslate({ session }))

    act(() => {
      void result.current.translate('source', TARGET)
    })

    act(() => {
      tabSessionRegistry.sweep(new Set())
    })

    expect(getSignal()?.aborted).toBe(true)
  })

  it('keeps two sessions independent', async () => {
    const runA = pendingTranslateText()
    const runB = pendingTranslateText()
    const sessionA = tabSessionRegistry.getOrCreate(newSessionId(), () => true)
    const sessionB = tabSessionRegistry.getOrCreate(newSessionId(), () => true)
    const a = renderHook(() => useTranslate({ session: sessionA }))
    const b = renderHook(() => useTranslate({ session: sessionB }))

    act(() => {
      void a.result.current.translate('a', TARGET)
    })

    // #18879: a run in one translate tab must not put the other one in a running state.
    expect(a.result.current.isTranslating).toBe(true)
    expect(b.result.current.isTranslating).toBe(false)

    act(() => {
      void b.result.current.translate('b', TARGET)
      a.result.current.cancel()
    })

    expect(runA.getSignal()?.aborted).toBe(true)
    expect(runB.getSignal()?.aborted).toBe(false)
    expect(b.result.current.isTranslating).toBe(true)
  })

  it('still aborts on unmount when no session owns the run', async () => {
    // Popups and overlays genuinely do own their run — that behaviour must not change.
    const { getSignal } = pendingTranslateText()
    const { result, unmount } = renderHook(() => useTranslate())

    act(() => {
      void result.current.translate('source', TARGET)
    })
    unmount()

    expect(getSignal()?.aborted).toBe(true)
  })
})
