import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { ResourceListItemBase, ResourceListRevealRequest } from '../ResourceListContext'
import type { ResourceListRemoteGroupSnapshot } from '../ResourceListRemoteGroups'
import { usePrepareResourceListRemoteReveal } from '../usePrepareResourceListRemoteReveal'

type Item = ResourceListItemBase

function createSnapshot(
  overrides: Partial<ResourceListRemoteGroupSnapshot<Item>> = {}
): ResourceListRemoteGroupSnapshot<Item> {
  return {
    groupId: 'ordinary',
    hasNext: true,
    isLoading: false,
    isRefreshing: false,
    items: [{ id: 'first', name: 'First' }],
    loadNext: vi.fn(),
    queryKey: 'ordinary:empty-query',
    retry: vi.fn(),
    ...overrides
  }
}

describe('usePrepareResourceListRemoteReveal', () => {
  it('loads each candidate forward and reveals only after the target is authoritative', () => {
    const request: ResourceListRevealRequest = { clearQuery: true, itemId: 'target', requestId: 1 }
    const loadPinned = vi.fn()
    const loadOrdinary = vi.fn()
    const onPrepare = vi.fn()
    const pinned = createSnapshot({ groupId: 'pinned', loadNext: loadPinned, queryKey: 'pinned:empty-query' })
    const ordinary = createSnapshot({ loadNext: loadOrdinary })
    const { rerender, result } = renderHook(
      ({ snapshots }) =>
        usePrepareResourceListRemoteReveal({
          candidateSnapshots: snapshots,
          isQueryReady: true,
          onPrepare,
          revealRequest: request
        }),
      { initialProps: { snapshots: [pinned, ordinary] as ResourceListRemoteGroupSnapshot<Item>[] } }
    )

    expect(onPrepare).toHaveBeenCalledWith(request)
    expect(loadPinned).toHaveBeenCalledTimes(1)
    expect(loadOrdinary).toHaveBeenCalledTimes(1)
    expect(result.current).toBeUndefined()

    rerender({
      snapshots: [
        { ...pinned, hasNext: false },
        {
          ...ordinary,
          items: [...ordinary.items, { id: 'target', name: 'Target' }]
        }
      ]
    })

    expect(result.current).toEqual(request)
  })

  it('waits for the prepared query identity before inspecting or paging snapshots', () => {
    const request: ResourceListRevealRequest = { itemId: 'target', requestId: 1 }
    const loadNext = vi.fn()
    const oldQuerySnapshot = createSnapshot({ loadNext, queryKey: 'ordinary:old-query' })
    const onPrepare = vi.fn()
    const { rerender, result } = renderHook(
      ({ isQueryReady, snapshot }) =>
        usePrepareResourceListRemoteReveal({
          candidateSnapshots: [snapshot],
          isQueryReady,
          onPrepare,
          revealRequest: request
        }),
      { initialProps: { isQueryReady: false, snapshot: oldQuerySnapshot } }
    )

    expect(onPrepare).toHaveBeenCalledWith(request)
    expect(loadNext).not.toHaveBeenCalled()
    expect(result.current).toBeUndefined()

    rerender({
      isQueryReady: true,
      snapshot: { ...oldQuerySnapshot, queryKey: 'ordinary:empty-query' }
    })

    expect(loadNext).toHaveBeenCalledTimes(1)
  })

  it('does not accept retained items while their replacement query is refreshing', () => {
    const request: ResourceListRevealRequest = { clearQuery: true, itemId: 'target', requestId: 1 }
    const onPrepare = vi.fn()
    const { rerender, result } = renderHook(
      ({ snapshot }) =>
        usePrepareResourceListRemoteReveal({
          candidateSnapshots: [snapshot],
          isQueryReady: true,
          onPrepare,
          revealRequest: request
        }),
      {
        initialProps: {
          snapshot: createSnapshot({
            isRefreshing: true,
            items: [{ id: 'target', name: 'Retained target' }],
            queryKey: 'ordinary:empty-query'
          })
        }
      }
    )

    expect(result.current).toBeUndefined()

    rerender({
      snapshot: createSnapshot({
        items: [{ id: 'first', name: 'Empty-query first page' }],
        queryKey: 'ordinary:empty-query'
      })
    })

    expect(result.current).toBeUndefined()
  })

  it('does not accept retained items when their replacement query fails', () => {
    const request: ResourceListRevealRequest = { clearQuery: true, itemId: 'target', requestId: 1 }
    const { result } = renderHook(() =>
      usePrepareResourceListRemoteReveal({
        candidateSnapshots: [
          createSnapshot({
            error: new Error('empty query failed'),
            items: [{ id: 'target', name: 'Retained target' }],
            queryKey: 'ordinary:empty-query'
          })
        ],
        isQueryReady: true,
        onPrepare: vi.fn(),
        revealRequest: request
      })
    )

    expect(result.current).toBeUndefined()
  })

  it('cancels an older reveal generation when a newer request arrives', () => {
    const firstRequest: ResourceListRevealRequest = { itemId: 'first-target', requestId: 1 }
    const secondRequest: ResourceListRevealRequest = { itemId: 'second-target', requestId: 2 }
    const onPrepare = vi.fn()
    const { rerender, result } = renderHook(
      ({ isQueryReady, request, snapshot }) =>
        usePrepareResourceListRemoteReveal({
          candidateSnapshots: [snapshot],
          isQueryReady,
          onPrepare,
          revealRequest: request
        }),
      {
        initialProps: {
          isQueryReady: true,
          request: firstRequest,
          snapshot: createSnapshot()
        }
      }
    )

    rerender({
      isQueryReady: false,
      request: secondRequest,
      snapshot: createSnapshot({
        items: [{ id: 'first-target', name: 'First target' }],
        queryKey: 'ordinary:first-query'
      })
    })
    expect(result.current).toBeUndefined()

    rerender({
      isQueryReady: true,
      request: secondRequest,
      snapshot: createSnapshot({
        items: [{ id: 'second-target', name: 'Second target' }],
        queryKey: 'ordinary:second-query'
      })
    })

    expect(result.current).toEqual(secondRequest)
    expect(onPrepare).toHaveBeenLastCalledWith(secondRequest)
  })

  it('stops when a page reports no progress', () => {
    const request: ResourceListRevealRequest = { itemId: 'target', requestId: 1 }
    const loadNext = vi.fn()
    const snapshot = createSnapshot({ loadNext })
    const { rerender } = renderHook(
      ({ currentSnapshot }) =>
        usePrepareResourceListRemoteReveal({
          candidateSnapshots: [currentSnapshot],
          isQueryReady: true,
          onPrepare: vi.fn(),
          revealRequest: request
        }),
      { initialProps: { currentSnapshot: snapshot } }
    )

    expect(loadNext).toHaveBeenCalledTimes(1)

    rerender({ currentSnapshot: { ...snapshot } })
    rerender({
      currentSnapshot: {
        ...snapshot,
        items: [...snapshot.items, { id: 'later-row', name: 'Later row' }]
      }
    })

    expect(loadNext).toHaveBeenCalledTimes(1)
  })

  it('keeps locating in an available candidate when another candidate fails', () => {
    const request: ResourceListRevealRequest = { itemId: 'target', requestId: 1 }
    const loadOrdinary = vi.fn()

    renderHook(() =>
      usePrepareResourceListRemoteReveal({
        candidateSnapshots: [
          createSnapshot({ error: new Error('pinned failed'), groupId: 'pinned', queryKey: 'pinned:empty-query' }),
          createSnapshot({ loadNext: loadOrdinary })
        ],
        isQueryReady: true,
        onPrepare: vi.fn(),
        revealRequest: request
      })
    )

    expect(loadOrdinary).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['error', { error: new Error('failed'), hasNext: true }],
    ['exhaustion', { hasNext: false }]
  ])('terminates on %s instead of restarting the same request', (_label, terminalState) => {
    const request: ResourceListRevealRequest = { itemId: 'target', requestId: 1 }
    const loadNext = vi.fn()
    const snapshot = createSnapshot({ loadNext, ...terminalState })
    const { rerender, result } = renderHook(
      ({ currentSnapshot }) =>
        usePrepareResourceListRemoteReveal({
          candidateSnapshots: [currentSnapshot],
          isQueryReady: true,
          onPrepare: vi.fn(),
          revealRequest: request
        }),
      { initialProps: { currentSnapshot: snapshot } }
    )

    rerender({ currentSnapshot: createSnapshot({ loadNext }) })

    expect(loadNext).not.toHaveBeenCalled()
    expect(result.current).toBeUndefined()
  })
})
