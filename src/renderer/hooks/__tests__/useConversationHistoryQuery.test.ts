import { dataApiService } from '@data/DataApiService'
import { act, renderHook, waitFor } from '@testing-library/react'
import { unstable_serialize } from 'swr'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createSWRTestWrapper as makeWrapper } from '../../data/hooks/__tests__/testUtils'

vi.unmock('@data/hooks/useDataApi')

import { useConversationHistoryQuery } from '../useConversationHistoryQuery'

describe('useConversationHistoryQuery', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('rejects parallel loading for cursor-paginated conversation history', () => {
    if ((false as boolean) === true) {
      void useConversationHistoryQuery('/topics/:topicId/messages', {
        params: { topicId: 'topic-1' },
        // @ts-expect-error - each page key depends on the previous page cursor
        swrOptions: { parallel: true }
      })
    }
  })

  it('removes a cursor page cache entry after revalidation replaces that cursor', async () => {
    let firstPageCursor = 'cursor-1'
    vi.spyOn(dataApiService, 'get').mockImplementation((async (
      _path: string,
      options: { query?: { cursor?: string } } = {}
    ) => {
      if (!options.query?.cursor) {
        return { items: [], nextCursor: firstPageCursor, activeNodeId: null }
      }
      return { items: [], nextCursor: undefined, activeNodeId: null }
    }) as never)

    const path = '/topics/topic-1/messages'
    const { Wrapper, cache } = makeWrapper()
    const { result, unmount } = renderHook(
      () =>
        useConversationHistoryQuery('/topics/:topicId/messages', {
          params: { topicId: 'topic-1' },
          swrOptions: { dedupingInterval: 0 }
        }),
      { wrapper: Wrapper }
    )

    await waitFor(() => expect(result.current.pages).toHaveLength(1))
    act(() => result.current.loadNext())
    await waitFor(() => expect(result.current.pages).toHaveLength(2))

    const firstCursorPageKey = unstable_serialize([path, { cursor: 'cursor-1', limit: 10 }])
    expect(cache.has(firstCursorPageKey)).toBe(true)

    firstPageCursor = 'cursor-2'
    await act(async () => {
      await result.current.mutate()
    })

    const nextCursorPageKey = unstable_serialize([path, { cursor: 'cursor-2', limit: 10 }])
    await waitFor(() => {
      expect(cache.has(firstCursorPageKey)).toBe(false)
      expect(cache.has(nextCursorPageKey)).toBe(true)
    })

    vi.useFakeTimers()
    unmount()
    vi.clearAllTimers()
  })
})
