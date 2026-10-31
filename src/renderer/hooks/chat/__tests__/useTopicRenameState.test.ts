import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cacheService } from '@renderer/data/CacheService'
import { installCacheApiMock } from '@renderer/data/hooks/__tests__/testUtils'
import { useTopicRenameState } from '@renderer/hooks/chat/useTopicRenameState'

vi.unmock('@renderer/data/CacheService')

beforeEach(() => {
  installCacheApiMock()
  cacheService.delete('topic.renaming')
  cacheService.delete('topic.newly_renamed')
})

describe('useTopicRenameState', () => {
  it('ignores unrelated topics and observes both matching rename states', () => {
    let renders = 0
    const { result } = renderHook(() => {
      renders++
      return useTopicRenameState('topic-a')
    })
    const initialRenders = renders

    act(() => {
      cacheService.set('topic.renaming', ['topic-b'])
      cacheService.set('topic.newly_renamed', ['topic-b'])
    })
    expect(renders).toBe(initialRenders)
    expect(result.current).toEqual({ isRenaming: false, isNewlyRenamed: false })

    act(() => cacheService.set('topic.renaming', ['topic-a', 'topic-b']))
    expect(result.current).toEqual({ isRenaming: true, isNewlyRenamed: false })
    act(() => cacheService.set('topic.newly_renamed', ['topic-a']))
    expect(result.current).toEqual({ isRenaming: true, isNewlyRenamed: true })
    act(() => cacheService.set('topic.renaming', []))
    expect(result.current).toEqual({ isRenaming: false, isNewlyRenamed: true })
    act(() => {
      cacheService.delete('topic.newly_renamed')
    })
    expect(result.current).toEqual({ isRenaming: false, isNewlyRenamed: false })
  })

  it('reads the new topic immediately when a row is reused', () => {
    cacheService.set('topic.renaming', ['topic-a'])
    cacheService.set('topic.newly_renamed', ['topic-b'])
    const { result, rerender } = renderHook(({ id }) => useTopicRenameState(id), {
      initialProps: { id: 'topic-a' }
    })
    expect(result.current).toEqual({ isRenaming: true, isNewlyRenamed: false })
    rerender({ id: 'topic-b' })
    expect(result.current).toEqual({ isRenaming: false, isNewlyRenamed: true })
    act(() => cacheService.set('topic.renaming', ['topic-b']))
    expect(result.current).toEqual({ isRenaming: true, isNewlyRenamed: true })
  })
})
