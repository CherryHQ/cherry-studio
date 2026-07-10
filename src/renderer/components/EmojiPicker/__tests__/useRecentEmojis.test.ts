import { act, renderHook, waitFor } from '@testing-library/react'
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

  it('filters unsupported persisted emojis and cleans the cache', async () => {
    const unsupportedEmoji = '👨‍👩‍👧‍👦'
    MockUseCacheUtils.setPersistCacheValue('ui.emoji.recently_used', ['🧠', unsupportedEmoji, '📁'])

    const { result } = renderHook(() => useRecentEmojis())

    expect(result.current.recent).toEqual(['🧠', '📁'])
    await waitFor(() => expect(MockUseCacheUtils.getPersistCacheValue('ui.emoji.recently_used')).toEqual(['🧠', '📁']))
  })

  it('ignores unsupported emojis when pushing recent entries', () => {
    const unsupportedEmoji = '👨‍👩‍👧‍👦'
    MockUseCacheUtils.setPersistCacheValue('ui.emoji.recently_used', ['🧠'])

    const { result } = renderHook(() => useRecentEmojis())
    act(() => {
      result.current.pushRecent(unsupportedEmoji)
    })

    expect(MockUseCacheUtils.getPersistCacheValue('ui.emoji.recently_used')).toEqual(['🧠'])
  })

  it('promotes a repeated emoji without duplicating it', () => {
    MockUseCacheUtils.setPersistCacheValue('ui.emoji.recently_used', ['🧠', '📁', '📚'])

    const { result } = renderHook(() => useRecentEmojis())
    act(() => {
      result.current.pushRecent('📁')
    })
    expect(MockUseCacheUtils.getPersistCacheValue('ui.emoji.recently_used')).toEqual(['📁', '🧠', '📚'])
  })

  it('caps the list at 32 entries', () => {
    const seed = [
      '😀',
      '😃',
      '😄',
      '😁',
      '😆',
      '😅',
      '😂',
      '🙂',
      '🙃',
      '😉',
      '😊',
      '😇',
      '🥰',
      '😍',
      '🤩',
      '😘',
      '😗',
      '😚',
      '😋',
      '😛',
      '😜',
      '🤪',
      '🤨',
      '🧐',
      '🤓',
      '😎',
      '🥳',
      '😏',
      '😒',
      '😞',
      '😔',
      '😟'
    ]
    MockUseCacheUtils.setPersistCacheValue('ui.emoji.recently_used', seed)

    const { result } = renderHook(() => useRecentEmojis())
    act(() => {
      result.current.pushRecent('🚀')
    })

    const next = MockUseCacheUtils.getPersistCacheValue('ui.emoji.recently_used')
    expect(next).toHaveLength(32)
    expect(next[0]).toBe('🚀')
    expect(next).not.toContain('😟')
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
