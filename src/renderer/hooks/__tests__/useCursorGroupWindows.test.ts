import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useCursorGroupWindows } from '../useCursorGroupWindows'

type Item = { id: string; name: string }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function renderGroupWindows({
  expandedGroupIds = [],
  fetchPage,
  groupIds = ['group-a'],
  queryKey = 'query-a'
}: {
  expandedGroupIds?: string[]
  fetchPage: (groupId: string, cursor?: string) => Promise<{ items: Item[]; nextCursor?: string }>
  groupIds?: string[]
  queryKey?: string
}) {
  return renderHook(
    (props) =>
      useCursorGroupWindows<Item>({
        enabled: true,
        expandedGroupIds: props.expandedGroupIds,
        fetchPage,
        getItemId: (item) => item.id,
        groupIds: props.groupIds,
        queryKey: props.queryKey
      }),
    { initialProps: { expandedGroupIds, groupIds, queryKey } }
  )
}

describe('useCursorGroupWindows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shares an in-flight request for the same group window', async () => {
    const page = deferred<{ items: Item[] }>()
    const fetchPage = vi.fn(() => page.promise)
    const { result } = renderGroupWindows({ fetchPage })

    let first!: Promise<void>
    let second!: Promise<void>
    act(() => {
      first = result.current.ensureGroup('group-a')
      second = result.current.ensureGroup('group-a')
    })

    expect(second).toBe(first)
    expect(fetchPage).toHaveBeenCalledTimes(1)

    await act(async () => {
      page.resolve({ items: [{ id: 'item-a', name: 'A' }] })
      await second
    })
    expect(result.current.items).toEqual([{ id: 'item-a', name: 'A' }])
  })

  it('loads initially expanded groups and a group expanded later', async () => {
    const fetchPage = vi.fn(async (groupId: string) => ({
      items: [{ id: `item-${groupId}`, name: groupId }]
    }))
    const { rerender } = renderGroupWindows({
      expandedGroupIds: ['group-a'],
      fetchPage,
      groupIds: ['group-a', 'group-b']
    })

    await waitFor(() => expect(fetchPage).toHaveBeenCalledWith('group-a', undefined))
    expect(fetchPage).not.toHaveBeenCalledWith('group-b', undefined)

    rerender({
      expandedGroupIds: ['group-a', 'group-b'],
      groupIds: ['group-a', 'group-b'],
      queryKey: 'query-a'
    })

    await waitFor(() => expect(fetchPage).toHaveBeenCalledWith('group-b', undefined))
  })

  it('appends and deduplicates the next cursor page inside one group', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({
        items: [
          { id: 'item-a', name: 'A' },
          { id: 'item-b', name: 'B' }
        ],
        nextCursor: 'cursor-b'
      })
      .mockResolvedValueOnce({
        items: [
          { id: 'item-b', name: 'Duplicate B' },
          { id: 'item-c', name: 'C' }
        ]
      })
    const { result } = renderGroupWindows({ fetchPage })

    await act(async () => {
      await result.current.ensureGroup('group-a')
      await result.current.loadMoreGroup('group-a')
    })

    expect(fetchPage).toHaveBeenNthCalledWith(2, 'group-a', 'cursor-b')
    expect(result.current.windows['group-a']?.items.map((item) => item.id)).toEqual(['item-a', 'item-b', 'item-c'])
    expect(result.current.windows['group-a']?.items[1]?.name).toBe('Duplicate B')
  })

  it('ignores a stale page after the query family changes', async () => {
    const page = deferred<{ items: Item[] }>()
    const fetchPage = vi.fn(() => page.promise)
    const { result, rerender } = renderGroupWindows({ fetchPage })

    let request!: Promise<void>
    act(() => {
      request = result.current.ensureGroup('group-a')
    })
    rerender({ expandedGroupIds: [], groupIds: ['group-a'], queryKey: 'query-b' })

    await act(async () => {
      page.resolve({ items: [{ id: 'stale', name: 'Stale' }] })
      await request
    })
    expect(result.current.windows).toEqual({})
  })

  it('preserves sibling windows when the available group set changes', async () => {
    const fetchPage = vi.fn(async (groupId: string) => ({
      items: [{ id: `item-${groupId}`, name: groupId }]
    }))
    const { result, rerender } = renderGroupWindows({
      fetchPage,
      groupIds: ['group-a', 'group-b']
    })

    await act(async () => {
      await Promise.all([result.current.ensureGroup('group-a'), result.current.ensureGroup('group-b')])
    })
    const groupAWindow = result.current.windows['group-a']

    rerender({ expandedGroupIds: [], groupIds: ['group-a', 'group-b', 'group-c'], queryKey: 'query-a' })
    expect(result.current.windows['group-a']).toBe(groupAWindow)
    expect(result.current.windows['group-b']).toBeDefined()

    rerender({ expandedGroupIds: [], groupIds: ['group-a', 'group-c'], queryKey: 'query-a' })
    expect(result.current.windows['group-a']).toBe(groupAWindow)
    expect(result.current.windows['group-b']).toBeUndefined()
  })
})
