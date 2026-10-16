import { act, renderHook, waitFor } from '@testing-library/react'
import type { WebviewTag } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useWebviewDebugging } from '../useWebviewDebugging'

type DebuggingState = { webviewId: number; attached: boolean; revision: number }
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  listeners: new Set<(value: DebuggingState) => void>()
}))
vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: mocks.request,
    on: (_name: string, callback: (value: DebuggingState) => void) => {
      mocks.listeners.add(callback)
      return () => mocks.listeners.delete(callback)
    }
  }
}))
const guest = (id: number) => Object.assign(new EventTarget(), { getWebContentsId: () => id }) as WebviewTag
const notify = (value: DebuggingState) =>
  act(() => {
    for (const listener of mocks.listeners) listener(value)
  })

describe('useWebviewDebugging', () => {
  beforeEach(() => {
    mocks.listeners.clear()
    mocks.request.mockReset().mockResolvedValue({ attached: false, revision: 0 })
  })

  it('shows the current page attachment and ignores other pages and stale snapshots', async () => {
    let snapshot!: (value: { attached: boolean; revision: number }) => void
    mocks.request.mockReturnValue(
      new Promise((resolve) => {
        snapshot = resolve
      })
    )
    const webview = guest(7)
    const { result } = renderHook(() => useWebviewDebugging(webview))
    expect(result.current).toBe(false)
    notify({ webviewId: 8, attached: true, revision: 1 })
    expect(result.current).toBe(false)
    notify({ webviewId: 7, attached: true, revision: 2 })
    expect(result.current).toBe(true)
    await act(async () => snapshot({ attached: false, revision: 0 }))
    expect(result.current).toBe(true)
    notify({ webviewId: 7, attached: false, revision: 3 })
    expect(result.current).toBe(false)
  })

  it('loads an existing attachment and drops it when the pooled webview is replaced', async () => {
    mocks.request.mockResolvedValueOnce({ attached: true, revision: 4 })
    const first = guest(7)
    const second = guest(9)
    const { result, rerender, unmount } = renderHook(({ webview }) => useWebviewDebugging(webview), {
      initialProps: { webview: first }
    })
    await waitFor(() => expect(result.current).toBe(true))
    rerender({ webview: second })
    expect(result.current).toBe(false)
    notify({ webviewId: 7, attached: true, revision: 5 })
    expect(result.current).toBe(false)
    notify({ webviewId: 9, attached: true, revision: 6 })
    expect(result.current).toBe(true)
    unmount()
    expect(mocks.listeners.size).toBe(0)
  })

  it('keeps the indicator through navigation and reads the new guest when its native identity changes', async () => {
    mocks.request.mockResolvedValue({ attached: true, revision: 4 })
    let id = 7
    const webview = Object.assign(new EventTarget(), { getWebContentsId: () => id }) as WebviewTag
    const { result } = renderHook(() => useWebviewDebugging(webview))
    await waitFor(() => expect(result.current).toBe(true))
    await act(async () => {
      webview.dispatchEvent(new Event('dom-ready'))
    })
    expect(result.current).toBe(true)
    id = 9
    mocks.request.mockResolvedValue({ attached: false, revision: 5 })
    await act(async () => {
      webview.dispatchEvent(new Event('dom-ready'))
    })
    expect(result.current).toBe(false)
    notify({ webviewId: 7, attached: true, revision: 6 })
    expect(result.current).toBe(false)
    notify({ webviewId: 9, attached: true, revision: 7 })
    expect(result.current).toBe(true)
  })
})
