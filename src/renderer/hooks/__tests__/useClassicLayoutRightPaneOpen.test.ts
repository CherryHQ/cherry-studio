import { act, cleanup, renderHook } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cacheService } from '@data/CacheService'

vi.unmock('@data/CacheService')
vi.unmock('@data/hooks/useCache')

import { useClassicLayoutRightPaneOpen } from '../useClassicLayoutRightPaneOpen'
import { WindowFrameContext } from '../useWindowFrame'
import { useWindowScopedPersistCache } from '../useWindowScopedPersistCache'

const detachedWindowWrapper = ({ children }: { children: ReactNode }) =>
  createElement(WindowFrameContext, { value: { mode: 'window' } }, children)

const useMismatchedWindowCachePair = () => {
  // @ts-expect-error number persistence cannot seed a boolean window cache
  return useWindowScopedPersistCache('ui.chat.sidebar.width', 'ui.window.chat.right_pane_open_override')
}
void useMismatchedWindowCachePair

describe('useClassicLayoutRightPaneOpen', () => {
  beforeEach(() => {
    cacheService.setPersist('ui.chat.right_pane_open_override', null)
    cacheService.setPersist('ui.agent.right_pane_open_override', null)
  })

  afterEach(() => {
    cleanup()
    cacheService.cleanup()
  })

  it('uses the page default when chat has no explicit override', () => {
    cacheService.setPersist('ui.chat.right_pane_open_override', null)

    const right = renderHook(() => useClassicLayoutRightPaneOpen('chat', { enabled: true, defaultOpen: true }))
    const left = renderHook(() => useClassicLayoutRightPaneOpen('chat', { enabled: true, defaultOpen: false }))

    expect(right.result.current[0]).toBe(true)
    expect(left.result.current[0]).toBe(false)
  })

  it('lets an explicit false override a right-side default across remounts', () => {
    const first = renderHook(() => useClassicLayoutRightPaneOpen('chat', { enabled: true, defaultOpen: true }))

    const setFirstOpen = first.result.current[1]
    act(() => setFirstOpen(false))
    expect(cacheService.getPersist('ui.chat.right_pane_open_override')).toBe(false)
    first.unmount()

    const second = renderHook(() => useClassicLayoutRightPaneOpen('chat', { enabled: true, defaultOpen: true }))
    expect(second.result.current[0]).toBe(false)
  })

  it('lets an explicit true override a left-side default', () => {
    cacheService.setPersist('ui.chat.right_pane_open_override', true)

    const { result } = renderHook(() => useClassicLayoutRightPaneOpen('chat', { enabled: true, defaultOpen: false }))

    expect(result.current[0]).toBe(true)
  })

  it('stays closed and ignores normal writes outside classic layout', () => {
    cacheService.setPersist('ui.chat.right_pane_open_override', true)
    const { result } = renderHook(() => useClassicLayoutRightPaneOpen('chat', { enabled: false, defaultOpen: true }))

    expect(result.current[0]).toBe(false)
    const setOpen = result.current[1]
    act(() => setOpen(false))
    expect(cacheService.getPersist('ui.chat.right_pane_open_override')).toBe(true)
  })

  it('allows a forced write while the layout preference is changing', () => {
    const { result } = renderHook(() => useClassicLayoutRightPaneOpen('chat', { enabled: false, defaultOpen: false }))

    const setOpen = result.current[1]
    act(() => setOpen(true, { force: true }))

    expect(cacheService.getPersist('ui.chat.right_pane_open_override')).toBe(true)
  })

  it('keeps chat and agent overrides independent', () => {
    const chat = renderHook(() => useClassicLayoutRightPaneOpen('chat', { enabled: true, defaultOpen: true }))
    const agent = renderHook(() => useClassicLayoutRightPaneOpen('agent', { enabled: true, defaultOpen: false }))

    const setChatOpen = chat.result.current[1]
    const setAgentOpen = agent.result.current[1]
    act(() => setChatOpen(false))
    act(() => setAgentOpen(true))

    expect(cacheService.getPersist('ui.chat.right_pane_open_override')).toBe(false)
    expect(cacheService.getPersist('ui.agent.right_pane_open_override')).toBe(true)
  })

  it.each([
    {
      surface: 'chat' as const,
      persistCacheKey: 'ui.chat.right_pane_open_override' as const,
      windowCacheKey: 'ui.window.chat.right_pane_open_override' as const
    },
    {
      surface: 'agent' as const,
      persistCacheKey: 'ui.agent.right_pane_open_override' as const,
      windowCacheKey: 'ui.window.agent.right_pane_open_override' as const
    }
  ])('keeps detached $surface writes out of persisted cache', ({ surface, persistCacheKey, windowCacheKey }) => {
    cacheService.setPersist(persistCacheKey, false)
    cacheService.set(windowCacheKey, false)
    const { result } = renderHook(() => useClassicLayoutRightPaneOpen(surface, { enabled: true, defaultOpen: true }), {
      wrapper: detachedWindowWrapper
    })

    expect(result.current[0]).toBe(false)
    act(() => result.current[1](true))

    expect(cacheService.get(windowCacheKey)).toBe(true)
    expect(cacheService.getPersist(persistCacheKey)).toBe(false)
  })

  it.each([
    {
      surface: 'chat' as const,
      persistCacheKey: 'ui.chat.right_pane_open_override' as const,
      windowCacheKey: 'ui.window.chat.right_pane_open_override' as const
    },
    {
      surface: 'agent' as const,
      persistCacheKey: 'ui.agent.right_pane_open_override' as const,
      windowCacheKey: 'ui.window.agent.right_pane_open_override' as const
    }
  ])(
    'keeps a detached $surface pane independent of persisted changes once it holds its own value',
    ({ surface, persistCacheKey, windowCacheKey }) => {
      cacheService.setPersist(persistCacheKey, true)
      cacheService.set(windowCacheKey, true)

      const { result } = renderHook(
        () => useClassicLayoutRightPaneOpen(surface, { enabled: true, defaultOpen: false }),
        { wrapper: detachedWindowWrapper }
      )
      expect(result.current[0]).toBe(true)

      // A main-window toggle reaches a detached renderer only through the persisted broadcast;
      // once the detached pane holds its own value it must not follow that broadcast.
      act(() => cacheService.setPersist(persistCacheKey, false))

      expect(result.current[0]).toBe(true)
      expect(cacheService.getPersist(persistCacheKey)).toBe(false)
    }
  )

  it.each(['chat', 'agent'] as const)(
    'keeps an untouched detached %s pane at its default after a main-window toggle and remount',
    (surface) => {
      const main = renderHook(() => useClassicLayoutRightPaneOpen(surface, { enabled: true, defaultOpen: false }))
      const detached = renderHook(() => useClassicLayoutRightPaneOpen(surface, { enabled: true, defaultOpen: false }), {
        wrapper: detachedWindowWrapper
      })
      expect(detached.result.current[0]).toBe(false)

      act(() => main.result.current[1](true))

      expect(main.result.current[0]).toBe(true)
      expect(detached.result.current[0]).toBe(false)
      detached.unmount()

      const reopened = renderHook(() => useClassicLayoutRightPaneOpen(surface, { enabled: true, defaultOpen: false }), {
        wrapper: detachedWindowWrapper
      })
      expect(reopened.result.current[0]).toBe(false)
    }
  )
})
