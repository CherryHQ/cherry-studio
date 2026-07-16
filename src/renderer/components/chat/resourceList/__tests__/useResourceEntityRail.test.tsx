import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { ResourceListGroupReorderPayload, ResourceListItemReorderPayload } from '../base'
import { useResourceEntityRail } from '../useResourceEntityRail'

type TestEntity = {
  id: string
  name: string
  icon: string
  orderKey?: string
  pinned?: boolean
}

type TestResource = {
  id: string
  entityId: string
}

const ENTITIES: TestEntity[] = [
  { id: 'assistant-a', name: 'Assistant A', icon: 'A', orderKey: 'a' },
  { id: 'assistant-b', name: 'Assistant B', icon: 'B', orderKey: 'b' }
]

const RESOURCES: TestResource[] = [
  { id: 'topic-a', entityId: 'assistant-a' },
  { id: 'topic-b', entityId: 'assistant-b' }
]
const RESOURCE_COUNTS = new Map([
  ['assistant-a', 1],
  ['assistant-b', 1]
])

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, reject, resolve }
}

function createItemReorderPayload(overId = 'assistant-b'): ResourceListItemReorderPayload {
  return {
    type: 'item',
    activeId: 'assistant-a',
    overId,
    position: 'after',
    overType: 'item',
    sourceGroupId: 'entities',
    targetGroupId: 'entities',
    sourceIndex: 0,
    targetIndex: 1
  }
}

function createGroupReorderPayload(): ResourceListGroupReorderPayload {
  return {
    type: 'group',
    activeGroupId: 'group-a',
    overGroupId: 'group-b',
    overType: 'group',
    sourceIndex: 0,
    targetIndex: 1
  }
}

function renderRail(overrides: Partial<Parameters<typeof useResourceEntityRail<TestEntity, TestResource>>[0]> = {}) {
  return renderHook(
    (props: Parameters<typeof useResourceEntityRail<TestEntity, TestResource>>[0]) => useResourceEntityRail(props),
    {
      initialProps: {
        entities: ENTITIES,
        resourceCountByEntityId: RESOURCE_COUNTS,
        activeEntityId: 'assistant-a',
        isLoading: false,
        isError: false,
        onPickResource: vi.fn(),
        loadResourceForEntity: vi.fn(
          async (entityId) => RESOURCES.find((resource) => resource.entityId === entityId) ?? null
        ),
        reorder: vi.fn().mockResolvedValue(undefined),
        refetchEntities: vi.fn().mockResolvedValue(undefined),
        onReorderError: vi.fn(),
        ...overrides
      }
    }
  )
}

describe('useResourceEntityRail', () => {
  it('keeps existing rail items visible during background loading', () => {
    const { result } = renderRail({ isLoading: true })

    expect(result.current.listStatus).toBe('idle')
    expect(result.current.items.map((item) => item.id)).toEqual(['assistant-a', 'assistant-b'])
  })

  it('shows loading only while there are no confirmed entity rows', () => {
    const { result } = renderRail({ isLoading: true, resourceCountByEntityId: new Map() })

    expect(result.current.listStatus).toBe('loading')
    expect(result.current.items).toEqual([])
  })

  it('hides a brand-new entity that owns no resources while keeping the others shown', () => {
    const { result } = renderRail({
      entities: [...ENTITIES, { id: 'assistant-c', name: 'Assistant C', icon: 'C', orderKey: 'c' }]
    })

    expect(result.current.items.map((item) => item.id)).toEqual(['assistant-a', 'assistant-b'])
  })

  it('updates selection while keeping the list mounted during loading', () => {
    const { result, rerender } = renderRail({ isLoading: true, activeEntityId: 'assistant-a' })

    expect(result.current.listStatus).toBe('idle')
    expect(result.current.selectedId).toBe('assistant-a')

    rerender({
      entities: ENTITIES,
      resourceCountByEntityId: RESOURCE_COUNTS,
      activeEntityId: 'assistant-b',
      isLoading: true,
      isError: false,
      onPickResource: vi.fn(),
      loadResourceForEntity: vi.fn(
        async (entityId) => RESOURCES.find((resource) => resource.entityId === entityId) ?? null
      ),
      reorder: vi.fn().mockResolvedValue(undefined),
      refetchEntities: vi.fn().mockResolvedValue(undefined),
      onReorderError: vi.fn()
    })

    expect(result.current.listStatus).toBe('idle')
    expect(result.current.selectedId).toBe('assistant-b')
    expect(result.current.items.map((item) => item.id)).toEqual(['assistant-a', 'assistant-b'])
  })

  it('loads and enters the owner resource on select even while counts are refreshing', async () => {
    const onPickResource = vi.fn()
    const { result } = renderRail({ isLoading: true, onPickResource })

    await act(async () => {
      await result.current.handleSelect(ENTITIES[0])
    })

    expect(onPickResource).toHaveBeenCalledWith(RESOURCES[0])
  })

  it('ignores an older owner-resource lookup that resolves after the latest selection', async () => {
    const firstLookup = createDeferred<TestResource | null>()
    const secondLookup = createDeferred<TestResource | null>()
    const loadResourceForEntity = vi.fn((entityId: string) =>
      entityId === 'assistant-a' ? firstLookup.promise : secondLookup.promise
    )
    const onPickResource = vi.fn()
    const { result } = renderRail({ loadResourceForEntity, onPickResource })

    let firstSelection!: Promise<void>
    let secondSelection!: Promise<void>
    await act(async () => {
      firstSelection = result.current.handleSelect(ENTITIES[0])
      secondSelection = result.current.handleSelect(ENTITIES[1])
      secondLookup.resolve(RESOURCES[1])
      await secondSelection
    })

    expect(onPickResource).toHaveBeenCalledTimes(1)
    expect(onPickResource).toHaveBeenCalledWith(RESOURCES[1])

    await act(async () => {
      firstLookup.resolve(RESOURCES[0])
      await firstSelection
    })

    expect(onPickResource).toHaveBeenCalledTimes(1)
  })

  it('propagates a failure from the owner selection to the UI reporting boundary', async () => {
    const error = new Error('lookup failed')
    const onPickResource = vi.fn()
    const { result } = renderRail({
      loadResourceForEntity: vi.fn().mockRejectedValue(error),
      onPickResource
    })

    await act(async () => {
      await expect(result.current.handleSelect(ENTITIES[0])).rejects.toBe(error)
    })

    expect(onPickResource).not.toHaveBeenCalled()
  })

  it('floats pinned entities to the top while preserving relative order of each partition', () => {
    const { result } = renderRail({
      entities: [
        { id: 'assistant-a', name: 'Assistant A', icon: 'A', orderKey: 'a' },
        { id: 'assistant-b', name: 'Assistant B', icon: 'B', orderKey: 'b', pinned: true },
        { id: 'assistant-c', name: 'Assistant C', icon: 'C', orderKey: 'c' }
      ],
      resourceCountByEntityId: new Map([
        ['assistant-a', 1],
        ['assistant-b', 1],
        ['assistant-c', 1]
      ])
    })

    expect(result.current.items.map((item) => item.id)).toEqual(['assistant-b', 'assistant-a', 'assistant-c'])
  })

  it('reports the selected empty owner when its resource lookup returns no row', async () => {
    const onPickResource = vi.fn()
    const onEmptyResource = vi.fn()
    const emptyOwner = { id: 'assistant-c', name: 'Assistant C', icon: 'C', orderKey: 'c' }
    const { result } = renderRail({
      loadResourceForEntity: vi.fn().mockResolvedValue(null),
      onEmptyResource,
      onPickResource
    })

    await act(async () => {
      await result.current.handleSelect(emptyOwner)
    })

    expect(onPickResource).not.toHaveBeenCalled()
    expect(onEmptyResource).toHaveBeenCalledWith(emptyOwner)
  })

  it('applies optimistic reorder and refetches entities on success', async () => {
    const reorderDeferred = createDeferred<void>()
    const reorder = vi.fn(() => reorderDeferred.promise)
    const refetchEntities = vi.fn().mockResolvedValue(undefined)
    const { result } = renderRail({ reorder, refetchEntities })

    let reorderPromise!: Promise<void>
    await act(async () => {
      reorderPromise = result.current.handleReorder(createItemReorderPayload())
      await Promise.resolve()
    })

    expect(result.current.items.map((item) => item.id)).toEqual(['assistant-b', 'assistant-a'])
    expect(reorder).toHaveBeenCalledWith('assistant-a', { after: 'assistant-b' })

    await act(async () => {
      reorderDeferred.resolve()
      await reorderPromise
    })

    expect(refetchEntities).toHaveBeenCalledTimes(1)
    expect(result.current.items.map((item) => item.id)).toEqual(['assistant-b', 'assistant-a'])
  })

  it('rolls back optimistic reorder and reports the error when persistence fails', async () => {
    const error = new Error('reorder failed')
    const reorder = vi.fn().mockRejectedValue(error)
    const refetchEntities = vi.fn().mockResolvedValue(undefined)
    const onReorderError = vi.fn()
    const { result } = renderRail({ reorder, refetchEntities, onReorderError })

    await act(async () => {
      await result.current.handleReorder(createItemReorderPayload())
    })

    expect(result.current.items.map((item) => item.id)).toEqual(['assistant-a', 'assistant-b'])
    expect(onReorderError).toHaveBeenCalledWith(error)
    expect(refetchEntities).toHaveBeenCalledTimes(1)
  })

  it('ignores non-item and unknown reorder payloads', async () => {
    const reorder = vi.fn().mockResolvedValue(undefined)
    const refetchEntities = vi.fn().mockResolvedValue(undefined)
    const { result } = renderRail({ reorder, refetchEntities })

    await act(async () => {
      await result.current.handleReorder(createGroupReorderPayload())
      await result.current.handleReorder(createItemReorderPayload('missing-assistant'))
    })

    expect(reorder).not.toHaveBeenCalled()
    expect(refetchEntities).not.toHaveBeenCalled()
    expect(result.current.items.map((item) => item.id)).toEqual(['assistant-a', 'assistant-b'])
  })
})
