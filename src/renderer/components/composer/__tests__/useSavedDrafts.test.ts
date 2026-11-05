import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { useSavedDrafts } from '../useSavedDrafts'

const draft = (text: string) => ({ text, tokens: [] })

describe('useSavedDrafts', () => {
  beforeEach(() => MockCacheUtils.resetMocks())

  it('keeps saved drafts in order per scope and removes by id', () => {
    const { result } = renderHook(() => useSavedDrafts('s1'))

    act(() => result.current.save(draft('a'), []))
    act(() => result.current.save(draft('b'), []))
    expect(result.current.items.map((i) => i.draft.text)).toEqual(['a', 'b'])

    act(() => result.current.remove(result.current.items[0].id))
    expect(result.current.items.map((i) => i.draft.text)).toEqual(['b'])
  })

  it('does not leak drafts between scopes', () => {
    const first = renderHook(() => useSavedDrafts('s1'))
    act(() => first.result.current.save(draft('a'), []))

    const second = renderHook(() => useSavedDrafts('s2'))
    expect(second.result.current.items).toEqual([])
  })
})
