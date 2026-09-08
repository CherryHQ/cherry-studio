/**
 * Regression coverage for row-local memory-cache selection. A topic rename
 * update must not re-render rows whose derived boolean stays false.
 */
import { cacheService } from '@data/CacheService'
import { useCacheSelector } from '@data/hooks/useCache'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installCacheApiMock } from './testUtils'

vi.unmock('@data/CacheService')
vi.unmock('@data/hooks/useCache')

const RENAMING_KEY = 'topic.renaming' as const

beforeEach(() => {
  installCacheApiMock()
  cacheService.delete(RENAMING_KEY)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useCacheSelector', () => {
  it('bails out when an unrelated topic changes and updates the matching row', () => {
    let renderCount = 0
    const { result } = renderHook(() => {
      renderCount++
      return useCacheSelector([RENAMING_KEY], ([topicIds]) => topicIds?.includes('topic-a') ?? false)
    })
    const initialRenderCount = renderCount

    act(() => {
      cacheService.set(RENAMING_KEY, ['topic-b'])
    })

    expect(result.current).toBe(false)
    expect(renderCount).toBe(initialRenderCount)

    act(() => {
      cacheService.set(RENAMING_KEY, ['topic-a', 'topic-b'])
    })

    expect(result.current).toBe(true)
    expect(renderCount).toBe(initialRenderCount + 1)
  })

  it('updates when the selected topic leaves the rename set', () => {
    act(() => {
      cacheService.set(RENAMING_KEY, ['topic-a'])
    })

    const { result } = renderHook(() =>
      useCacheSelector([RENAMING_KEY], ([topicIds]) => topicIds?.includes('topic-a') ?? false)
    )
    expect(result.current).toBe(true)

    act(() => {
      cacheService.set(RENAMING_KEY, [])
    })

    expect(result.current).toBe(false)
  })
})
