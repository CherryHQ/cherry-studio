import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { MockUseCacheUtils } from '../../../../../tests/__mocks__/renderer/useCache'
import { useRecentEmojis } from '../useRecentEmojis'

afterEach(() => {
  MockUseCacheUtils.resetMocks()
})

describe('useRecentEmojis', () => {
  it('returns the persisted list', () => {
    MockUseCacheUtils.setPersistCacheValue('ui.emoji.recently_used', ['🧠', '📁'])

    const { result } = renderHook(() => useRecentEmojis())
    expect(result.current.recent).toEqual(['🧠', '📁'])
  })

  it('pushes new emojis to the front and dedupes', () => {
    MockUseCacheUtils.setPersistCacheValue('ui.emoji.recently_used', ['🧠', '📁'])

    const { result } = renderHook(() => useRecentEmojis())
    act(() => {
      result.current.pushRecent('📚')
    })
    expect(MockUseCacheUtils.getPersistCacheValue('ui.emoji.recently_used')).toEqual(['📚', '🧠', '📁'])
  })

  it('promotes a repeated emoji without duplicating it', () => {
    MockUseCacheUtils.setPersistCacheValue('ui.emoji.recently_used', ['🧠', '📁', '📚'])

    const { result } = renderHook(() => useRecentEmojis())
    act(() => {
      result.current.pushRecent('📁')
    })
    expect(MockUseCacheUtils.getPersistCacheValue('ui.emoji.recently_used')).toEqual(['📁', '🧠', '📚'])
  })

  it('clears the list', () => {
    MockUseCacheUtils.setPersistCacheValue('ui.emoji.recently_used', ['🧠', '📁'])

    const { result } = renderHook(() => useRecentEmojis())
    act(() => {
      result.current.clearRecent()
    })
    expect(MockUseCacheUtils.getPersistCacheValue('ui.emoji.recently_used')).toEqual([])
  })
})
