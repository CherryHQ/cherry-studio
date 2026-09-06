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
      signal?: AbortSignal,
      streamId?: string
    ) => Promise<string>
  >()
vi.mock('@renderer/utils/translate', () => ({
  createTranslateStreamId: () => `translate:${(streamSeq += 1)}`,
  translateText: (...args: any[]) => translateTextMock(...(args as Parameters<typeof translateTextMock>))
}))

let streamSeq = 0

const abortRequest = vi.fn().mockResolvedValue(undefined)
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: (...args: unknown[]) => abortRequest(...args) } }))

/** What the session would abort by — the id `useTranslate` handed to `translateText`. */
const abortedStreams = () => abortRequest.mock.calls.map(([, payload]) => (payload as { topicId: string }).topicId)

vi.mock('@renderer/utils/error', () => ({
  formatErrorMessageWithPrefix: (err: unknown, prefix: string) => `${prefix}: ${String(err)}`,
  isAbortError: (err: unknown) => (err as Error)?.name === 'AbortError'
}))

import { tabSessionRegistry } from '@renderer/services/TabSessionRegistry'

import { useTranslate } from '../useTranslate'
import { useTranslateSession } from '../useTranslateSession'

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
  let streamId: string | undefined
  translateTextMock.mockImplementationOnce(
    (_text, _lang, _onResponse, abortSignal, id) =>
      new Promise<string>((_resolve, reject) => {
        signal = abortSignal
        streamId = id
        abortSignal?.addEventListener('abort', () => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        })
      })
  )
  return { getSignal: () => signal, getStreamId: () => streamId }
}

let sessionSeq = 0
/** The real translate session, so these tests exercise the runtime the page actually gets. */
const newSession = () => renderHook(() => useTranslateSession(`session-${(sessionSeq += 1)}`)).result.current

beforeEach(() => {
  vi.clearAllMocks()
  translateTextMock.mockReset()
  abortRequest.mockClear()
})

describe('useTranslateSession', () => {
  it('fails loudly without a session id rather than inventing one', () => {
    // A fallback id would be shared by every page in this state and would name a session no tab
    // refers to — the next sweep would cancel and release it under a page still using it.
    expect(() => renderHook(() => useTranslateSession(undefined))).toThrow(/tabSession/)
  })
})

describe('useTranslate with a tab session', () => {
  it('keeps the run alive when the page unmounts', async () => {
    // #18885: switching tabs unmounts the page under `Activity`; the run must not be cancelled.
    const { getSignal } = pendingTranslateText()
    const session = newSession()
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
    const session = newSession()
    const first = renderHook(() => useTranslate({ session }))

    act(() => {
      void first.result.current.translate('source', TARGET)
    })
    first.unmount()

    const second = renderHook(() => useTranslate({ session }))

    expect(second.result.current.isTranslating).toBe(true)
  })

  it('lets a remounted page cancel a run it never started', async () => {
    // The Stop button after a tab switch — this mount started nothing, so the stream id held by
    // the session is the only handle on the run.
    const { getStreamId } = pendingTranslateText()
    const session = newSession()
    const first = renderHook(() => useTranslate({ session }))

    act(() => {
      void first.result.current.translate('source', TARGET)
    })
    first.unmount()

    const second = renderHook(() => useTranslate({ session }))
    act(() => {
      second.result.current.cancel()
    })

    expect(abortedStreams()).toContain(getStreamId())
    expect(second.result.current.isTranslating).toBe(false)
  })

  it('aborts the run when the session is released', async () => {
    const { getStreamId } = pendingTranslateText()
    const session = newSession()
    const { result } = renderHook(() => useTranslate({ session }))

    act(() => {
      void result.current.translate('source', TARGET)
    })

    act(() => {
      tabSessionRegistry.sweep(new Set())
    })

    expect(abortedStreams()).toContain(getStreamId())
  })

  it('keeps two sessions independent', async () => {
    const runA = pendingTranslateText()
    const runB = pendingTranslateText()
    const sessionA = newSession()
    const sessionB = newSession()
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

    expect(abortedStreams()).toContain(runA.getStreamId())
    expect(abortedStreams()).not.toContain(runB.getStreamId())
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
