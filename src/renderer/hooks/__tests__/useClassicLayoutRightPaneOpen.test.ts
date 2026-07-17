import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/data/hooks/useCache', async () => {
  const { MockUseCache } = await import('@test-mocks/renderer/useCache')
  return MockUseCache
})

import { useClassicLayoutRightPaneOpen } from '../useClassicLayoutRightPaneOpen'

describe('useClassicLayoutRightPaneOpen', () => {
  beforeEach(() => {
    MockUseCacheUtils.resetMocks()
  })

  it('uses the page default when chat has no explicit override', () => {
    MockUseCacheUtils.setPersistCacheValue('ui.chat.right_pane_open', null)

    const right = renderHook(() => useClassicLayoutRightPaneOpen('chat', { enabled: true, defaultOpen: true }))
    const left = renderHook(() => useClassicLayoutRightPaneOpen('chat', { enabled: true, defaultOpen: false }))

    expect(right.result.current[0]).toBe(true)
    expect(left.result.current[0]).toBe(false)
  })

  it('lets an explicit false override a right-side default across remounts', () => {
    const first = renderHook(() => useClassicLayoutRightPaneOpen('chat', { enabled: true, defaultOpen: true }))

    const setFirstOpen = first.result.current[1]
    act(() => setFirstOpen(false))
    expect(MockUseCacheUtils.getPersistCacheValue('ui.chat.right_pane_open')).toBe(false)
    first.unmount()

    const second = renderHook(() => useClassicLayoutRightPaneOpen('chat', { enabled: true, defaultOpen: true }))
    expect(second.result.current[0]).toBe(false)
  })

  it('lets an explicit true override a left-side default', () => {
    MockUseCacheUtils.setPersistCacheValue('ui.chat.right_pane_open', true)

    const { result } = renderHook(() => useClassicLayoutRightPaneOpen('chat', { enabled: true, defaultOpen: false }))

    expect(result.current[0]).toBe(true)
  })

  it('stays closed and ignores normal writes outside classic layout', () => {
    MockUseCacheUtils.setPersistCacheValue('ui.chat.right_pane_open', true)
    const { result } = renderHook(() => useClassicLayoutRightPaneOpen('chat', { enabled: false, defaultOpen: true }))

    expect(result.current[0]).toBe(false)
    const setOpen = result.current[1]
    act(() => setOpen(false))
    expect(MockUseCacheUtils.getPersistCacheValue('ui.chat.right_pane_open')).toBe(true)
  })

  it('allows a forced write while the layout preference is changing', () => {
    const { result } = renderHook(() => useClassicLayoutRightPaneOpen('chat', { enabled: false, defaultOpen: false }))

    const setOpen = result.current[1]
    act(() => setOpen(true, { force: true }))

    expect(MockUseCacheUtils.getPersistCacheValue('ui.chat.right_pane_open')).toBe(true)
  })

  it('keeps chat and agent overrides independent', () => {
    const chat = renderHook(() => useClassicLayoutRightPaneOpen('chat', { enabled: true, defaultOpen: true }))
    const agent = renderHook(() => useClassicLayoutRightPaneOpen('agent', { enabled: true, defaultOpen: false }))

    const setChatOpen = chat.result.current[1]
    const setAgentOpen = agent.result.current[1]
    act(() => setChatOpen(false))
    act(() => setAgentOpen(true))

    expect(MockUseCacheUtils.getPersistCacheValue('ui.chat.right_pane_open')).toBe(false)
    expect(MockUseCacheUtils.getPersistCacheValue('ui.agent.right_pane_open')).toBe(true)
  })
})
