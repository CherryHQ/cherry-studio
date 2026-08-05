import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import useWindowFocus from '../useWindowFocus'

const requestMock = vi.fn()
const unsubscribe = vi.fn()
let focusChanged: ((focused: boolean) => void) | undefined

beforeEach(() => {
  vi.clearAllMocks()
  focusChanged = undefined
  vi.spyOn(document, 'hasFocus').mockReturnValue(false)
  requestMock.mockResolvedValue({ ok: true, data: true })
  ;(window as unknown as { api: unknown }).api = {
    ipcApi: {
      request: requestMock,
      on: vi.fn((event: string, callback: (payload: boolean) => void) => {
        if (event === 'window.focus_changed') focusChanged = callback
        return unsubscribe
      })
    }
  }
})

describe('useWindowFocus', () => {
  it('seeds state from the authoritative BrowserWindow query', async () => {
    const { result } = renderHook(() => useWindowFocus())

    expect(result.current).toBe(false)
    await waitFor(() => expect(result.current).toBe(true))
    expect(requestMock).toHaveBeenCalledWith('window.is_focused', undefined)
  })

  it('updates from native focus transitions', async () => {
    const { result } = renderHook(() => useWindowFocus())
    await waitFor(() => expect(result.current).toBe(true))

    act(() => focusChanged?.(false))
    expect(result.current).toBe(false)

    act(() => focusChanged?.(true))
    expect(result.current).toBe(true)
  })

  it('does not let a stale initial query overwrite a newer transition', async () => {
    let resolveQuery: ((value: { ok: true; data: boolean }) => void) | undefined
    requestMock.mockReturnValueOnce(new Promise((resolve) => (resolveQuery = resolve)))
    const { result } = renderHook(() => useWindowFocus())

    act(() => focusChanged?.(true))
    act(() => resolveQuery?.({ ok: true, data: false }))

    await waitFor(() => expect(result.current).toBe(true))
  })

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useWindowFocus())
    unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
