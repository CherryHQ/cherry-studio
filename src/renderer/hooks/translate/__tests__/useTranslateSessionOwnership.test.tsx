import { parseTranslateLangCode } from '@shared/data/preference/preferenceTypes'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => `t(${key})` })
}))

const ipcRequestMock = vi.hoisted(() => vi.fn())
const ipcHandlers = vi.hoisted(() => new Map<string, (payload: never) => void>())
vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: (...args: unknown[]) => ipcRequestMock(...args) },
  useIpcOn: (event: string, handler: (payload: never) => void) => {
    ipcHandlers.set(event, handler)
  }
}))

import { tabSessionRegistry } from '@renderer/services/TabSessionRegistry'

import { useTranslateSession } from '../useTranslateSession'
import { useTranslateTask } from '../useTranslateTask'

const TARGET = parseTranslateLangCode('en-us')

const REQUEST = {
  text: 'hello',
  sourceLangCode: 'auto' as const,
  targetLangCode: TARGET,
  bidirectional: false,
  bidirectionalPair: [parseTranslateLangCode('en-us'), parseTranslateLangCode('zh-cn')] as [
    ReturnType<typeof parseTranslateLangCode>,
    ReturnType<typeof parseTranslateLangCode>
  ]
}

let sessionSeq = 0
/** The real session, so these tests exercise the runtime the page actually gets. */
const newSession = () => renderHook(() => useTranslateSession(`session-${(sessionSeq += 1)}`)).result.current

const noop = { onText: () => undefined, onCompleted: () => undefined, onFailed: () => undefined }

const emit = (event: string, payload: unknown) => {
  act(() => ipcHandlers.get(event)?.(payload as never))
}

const requestsFor = (route: string) => ipcRequestMock.mock.calls.filter(([name]) => name === route)

beforeEach(() => {
  ipcRequestMock.mockReset()
  ipcHandlers.clear()
  ipcRequestMock.mockImplementation((route: string) => {
    if (route === 'translate.task.start') return Promise.resolve({ taskId: 'task-1', streamId: 'translate:task-1' })
    return Promise.resolve(undefined)
  })
})

describe('useTranslateSession', () => {
  it('fails loudly without a session id rather than inventing one', () => {
    // A fallback id would be shared by every page in this state and would name a session no tab
    // refers to — the next sweep would cancel and release it under a page still using it.
    expect(() => renderHook(() => useTranslateSession(undefined))).toThrow(/tabSession/)
  })
})

describe('useTranslateTask', () => {
  it('leaves the task running when the page unmounts', async () => {
    // #18885: switching tabs unmounts the page under `Activity`; the translation must not stop.
    const session = newSession()
    const { result, unmount } = renderHook(() => useTranslateTask(session, noop))

    await act(async () => {
      await result.current.start(REQUEST)
    })
    expect(session.isBusy()).toBe(true)

    unmount()

    expect(requestsFor('translate.task.cancel')).toHaveLength(0)
    expect(session.isBusy()).toBe(true)
  })

  it('still reports the task as running to a page that mounted mid-run', async () => {
    const session = newSession()
    const first = renderHook(() => useTranslateTask(session, noop))
    await act(async () => {
      await first.result.current.start(REQUEST)
    })
    first.unmount()

    const second = renderHook(() => useTranslateTask(session, noop))

    expect(second.result.current.isBusy).toBe(true)
  })

  it('replays what a page missed while it was away', async () => {
    // The text lives in main, so a page coming back asks for it rather than reconstructing it.
    const session = newSession()
    const first = renderHook(() => useTranslateTask(session, noop))
    await act(async () => {
      await first.result.current.start(REQUEST)
    })
    first.unmount()

    ipcRequestMock.mockImplementation((route: string) =>
      route === 'translate.task.attach'
        ? Promise.resolve({
            taskId: 'task-1',
            streamId: 'translate:task-1',
            busy: true,
            accumulated: 'partial and more',
            detectedSourceLanguage: null
          })
        : Promise.resolve(undefined)
    )

    const seen: string[] = []
    await act(async () => {
      renderHook(() => useTranslateTask(session, { ...noop, onText: (text) => seen.push(text) }))
    })

    expect(requestsFor('translate.task.attach')[0][1]).toEqual({ taskId: 'task-1' })
    expect(seen).toContain('partial and more')
  })

  it('lets a page cancel a task it never started', async () => {
    // The Stop button after a tab switch — this mount started nothing, so the task id held by the
    // session is the only handle on the translation.
    const session = newSession()
    const first = renderHook(() => useTranslateTask(session, noop))
    await act(async () => {
      await first.result.current.start(REQUEST)
    })
    first.unmount()

    const second = renderHook(() => useTranslateTask(session, noop))
    act(() => second.result.current.cancel())

    expect(requestsFor('translate.task.cancel')[0][1]).toEqual({ taskId: 'task-1' })
    expect(second.result.current.isBusy).toBe(false)
  })

  it('cancels the task when the session is released', async () => {
    const session = newSession()
    const { result } = renderHook(() => useTranslateTask(session, noop))
    await act(async () => {
      await result.current.start(REQUEST)
    })

    act(() => {
      tabSessionRegistry.sweep(new Set())
    })

    expect(requestsFor('translate.task.cancel')[0][1]).toEqual({ taskId: 'task-1' })
  })

  it('keeps two sessions independent', async () => {
    // #18879: a translation in one tab must not put the other one in a running state.
    const sessionA = newSession()
    const sessionB = newSession()
    const a = renderHook(() => useTranslateTask(sessionA, noop))
    const b = renderHook(() => useTranslateTask(sessionB, noop))

    await act(async () => {
      await a.result.current.start(REQUEST)
    })

    expect(a.result.current.isBusy).toBe(true)
    expect(b.result.current.isBusy).toBe(false)
  })

  it('surfaces a failure as its i18n key, leaving the page to decide what to show', async () => {
    const session = newSession()
    const failures: string[] = []
    const { result } = renderHook(() => useTranslateTask(session, { ...noop, onFailed: (key) => failures.push(key) }))
    await act(async () => {
      await result.current.start(REQUEST)
    })

    emit('translate.task.failed', { taskId: 'task-1', messageKey: 'translate.language.same' })

    expect(failures).toEqual(['translate.language.same'])
  })
})
