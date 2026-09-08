// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { act, renderHook } from '@testing-library/react'
import type { WebviewTag } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useWebviewNavigation } from '../useWebviewNavigation'

function createGuest(url: string) {
  const guest = document.createElement('webview') as unknown as WebviewTag
  Object.assign(guest, {
    getURL: () => url,
    canGoBack: () => true,
    canGoForward: () => false,
    goBack: vi.fn(),
    goForward: vi.fn()
  })
  return guest
}

function navigate(guest: WebviewTag, url: string) {
  guest.dispatchEvent(Object.assign(new Event('did-navigate'), { url }))
}

afterEach(() => vi.useRealTimers())

describe('useWebviewNavigation guest ownership', () => {
  it('binds a late or replacement guest and ignores the retired guest and its delayed navigation update', () => {
    vi.useFakeTimers()
    const { result, rerender, unmount } = renderHook(useWebviewNavigation, {
      initialProps: { webview: null as WebviewTag | null, revision: 0, targetId: 'tab', url: 'https://start.test/' }
    })
    const first = createGuest('https://first.test/')
    rerender({ webview: first, revision: 1, targetId: 'tab', url: 'https://start.test/' })
    expect(result.current.currentPageUrl).toBe('https://first.test/')
    expect(result.current.canGoBack).toBe(true)
    act(() => navigate(first, 'https://first.test/pending'))

    const second = createGuest('https://second.test/')
    Object.assign(second, { canGoBack: () => false, canGoForward: () => true })
    rerender({ webview: second, revision: 2, targetId: 'tab', url: 'https://start.test/' })
    act(() => {
      navigate(first, 'https://retired.test/')
      vi.advanceTimersByTime(100)
    })
    expect(result.current.currentPageUrl).toBe('https://second.test/')
    expect(result.current.canGoBack).toBe(false)
    expect(result.current.canGoForward).toBe(true)
    act(() => result.current.goForward())
    expect(second.goForward).toHaveBeenCalledOnce()
    expect(first.goForward).not.toHaveBeenCalled()

    unmount()
    act(() => navigate(second, 'https://detached.test/'))
    expect(vi.getTimerCount()).toBe(0)
  })
})
