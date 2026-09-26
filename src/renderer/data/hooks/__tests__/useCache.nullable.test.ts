import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { cacheService } from '@data/CacheService'
import { useCache } from '@data/hooks/useCache'

vi.unmock('@data/CacheService')
vi.unmock('@data/hooks/useCache')

const key = 'ui.window.chat.right_pane_open_override'

afterEach(() => {
  cleanup()
  cacheService.cleanup()
})

describe('useCache nullable values', () => {
  it('keeps an explicit null when the initializer changes', () => {
    const { result, rerender } = renderHook(({ initial }) => useCache(key, initial), {
      initialProps: { initial: true }
    })
    expect(result.current[0]).toBe(true)

    act(() => result.current[1](null))
    expect(result.current[0]).toBeNull()

    rerender({ initial: false })
    expect(result.current[0]).toBeNull()
  })

  it('passes the latest stored null to a functional updater instead of its initializer', () => {
    const { result } = renderHook(() => useCache(key, true))
    const setValue = result.current[1]

    act(() => {
      cacheService.set(key, null)
      setValue((previous) => (previous === null ? false : previous))
    })

    expect(result.current[0]).toBe(false)
    expect(cacheService.get(key)).toBe(false)
  })
})
