import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useClassicLayoutRightPaneOpen } from '../useClassicLayoutRightPaneOpen'
import { WindowFrameContext } from '../useWindowFrame'

const cacheMock = vi.hoisted(() => ({
  persistedValue: true as boolean | null,
  windowValue: false as boolean | null,
  setPersisted: vi.fn(),
  setWindow: vi.fn()
}))

vi.mock('@data/hooks/useCache', () => ({
  useCache: vi.fn(() => [cacheMock.windowValue, cacheMock.setWindow]),
  usePersistCache: vi.fn(() => [cacheMock.persistedValue, cacheMock.setPersisted])
}))

describe('useClassicLayoutRightPaneOpen', () => {
  beforeEach(() => {
    cacheMock.setPersisted.mockClear()
    cacheMock.setWindow.mockClear()
  })

  it('uses the persisted override in the embedded frame', () => {
    const { result } = renderHook(() => useClassicLayoutRightPaneOpen('chat', { enabled: true, defaultOpen: false }))

    expect(result.current[0]).toBe(true)

    act(() => result.current[1](false))

    expect(cacheMock.setPersisted).toHaveBeenCalledWith(false)
    expect(cacheMock.setWindow).not.toHaveBeenCalled()
  })

  it('uses renderer-local state in a detached frame without changing the persisted override', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <WindowFrameContext value={{ mode: 'window' }}>{children}</WindowFrameContext>
    )
    const { result } = renderHook(() => useClassicLayoutRightPaneOpen('agent', { enabled: true, defaultOpen: true }), {
      wrapper
    })

    expect(result.current[0]).toBe(false)

    act(() => result.current[1](true))

    expect(cacheMock.setWindow).toHaveBeenCalledWith(true)
    expect(cacheMock.setPersisted).not.toHaveBeenCalled()
  })
})
