import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { cacheService } from '@data/CacheService'
import { useCache, useSharedCache } from '@data/hooks/useCache'

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

describe('useSharedCache nullable values', () => {
  const sharedKey = 'topic.stream.last_seen_completion.topic-1'

  it('preserves a stored null when the initializer changes', () => {
    const { result, rerender } = renderHook(({ initial }) => useSharedCache(sharedKey, initial), {
      initialProps: { initial: 7 }
    })
    act(() => result.current[1](null))
    rerender({ initial: 9 })
    expect(result.current[0]).toBeNull()
    expect(cacheService.getShared(sharedKey)).toBeNull()
  })

  it('passes the latest stored null to an updater instead of falling back to the initializer', () => {
    const { result } = renderHook(() => useSharedCache(sharedKey, 7))
    const setValue = result.current[1]
    act(() => {
      cacheService.setShared(sharedKey, null)
      setValue((previous) => (previous === null ? 42 : 99))
    })
    expect(result.current[0]).toBe(42)
    expect(cacheService.getShared(sharedKey)).toBe(42)
  })
})

describe('cache hook key validation', () => {
  it.each([undefined, 99])('rejects an invalid memory key even with initializer %s', (initial) => {
    expect(() => renderHook(() => useCache('scroll.position.', initial))).toThrow('Invalid memory cache key')
  })

  it('does not let an existing casual entry bypass the typed hook key contract', () => {
    cacheService.setCasual('scroll.position.', 5)
    expect(() => renderHook(() => useCache('scroll.position.'))).toThrow('Invalid memory cache key')
    expect(cacheService.getCasual<number>('scroll.position.')).toBe(5)
  })

  it('rejects an invalid shared key before creating a local or broadcast value', () => {
    expect(() => renderHook(() => useSharedCache('jobs.progress.', { progress: 0 }))).toThrow(
      'Invalid shared cache key'
    )
  })

  it('retains undefined for a valid schema entry that explicitly permits absence', () => {
    const { result } = renderHook(() => useCache('notes.active_file_path'))
    expect(result.current[0]).toBeUndefined()
  })

  it.each(['', 'a:b', 'a.b', '中文', 'valid\n'])(
    'rejects malformed keys through typed renderer cache entries: %j',
    (segment) => {
      const memoryKey = `scroll.position.${segment}` as const
      const sharedKey = `jobs.progress.${segment}` as const
      for (const operation of [
        () => cacheService.get(memoryKey),
        () => cacheService.set(memoryKey, 1),
        () => cacheService.has(memoryKey),
        () => cacheService.delete(memoryKey),
        () => cacheService.hasTTL(memoryKey)
      ])
        expect(operation).toThrow('Invalid memory cache key')
      for (const operation of [
        () => cacheService.getShared(sharedKey),
        () => cacheService.getSharedSnapshot(sharedKey),
        () => cacheService.setShared(sharedKey, { progress: 0 }),
        () => cacheService.hasShared(sharedKey),
        () => cacheService.deleteShared(sharedKey),
        () => cacheService.hasSharedTTL(sharedKey)
      ])
        expect(operation).toThrow('Invalid shared cache key')
    }
  )
})
