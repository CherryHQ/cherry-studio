import type { RouterHistory } from '@tanstack/react-router'
// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const commandMocks = vi.hoisted(() => ({
  handlers: new Map<string, { handler: () => void; enabled: boolean }>()
}))

vi.mock('@renderer/hooks/command', () => ({
  useCommandHandler: (command: string, handler: () => void, options?: { enabled?: boolean }) => {
    commandMocks.handlers.set(command, { handler, enabled: options?.enabled !== false })
  }
}))

import { useTabHistoryNavigation } from '../useTabHistoryNavigation'

const createHistory = (): RouterHistory =>
  ({
    back: vi.fn(),
    forward: vi.fn(),
    canGoBack: vi.fn(() => true),
    length: 2,
    location: { state: { __TSR_index: 0 } }
  }) as unknown as RouterHistory

afterEach(() => {
  cleanup()
  commandMocks.handlers.clear()
  vi.restoreAllMocks()
})

describe('useTabHistoryNavigation', () => {
  it('registers active-tab back/forward commands that no-op when the stack cannot move', () => {
    const history = createHistory()
    vi.mocked(history.canGoBack).mockReturnValue(false)
    Object.assign(history, { length: 1 })

    renderHook(() => useTabHistoryNavigation(history, true))

    const back = commandMocks.handlers.get('tab.history.back')
    const forward = commandMocks.handlers.get('tab.history.forward')
    expect(back?.enabled).toBe(true)
    expect(forward?.enabled).toBe(true)

    act(() => {
      back?.handler()
      forward?.handler()
    })

    expect(history.back).not.toHaveBeenCalled()
    expect(history.forward).not.toHaveBeenCalled()
  })

  it('moves history from mouse side buttons only while the tab is active', () => {
    const history = createHistory()
    const { rerender } = renderHook(({ enabled }) => useTabHistoryNavigation(history, enabled), {
      initialProps: { enabled: false }
    })

    act(() => {
      window.dispatchEvent(new MouseEvent('auxclick', { button: 3, bubbles: true, cancelable: true }))
    })
    expect(history.back).not.toHaveBeenCalled()

    rerender({ enabled: true })

    act(() => {
      window.dispatchEvent(new MouseEvent('auxclick', { button: 3, bubbles: true, cancelable: true }))
      window.dispatchEvent(new MouseEvent('auxclick', { button: 4, bubbles: true, cancelable: true }))
    })

    expect(history.back).toHaveBeenCalledTimes(1)
    expect(history.forward).toHaveBeenCalledTimes(1)
  })
})
