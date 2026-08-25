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
  updatedAt: number
}

const ENTITIES: TestEntity[] = [
  { id: 'assistant-a', name: 'Assistant A', icon: 'A', orderKey: 'a' },
  { id: 'assistant-b', name: 'Assistant B', icon: 'B', orderKey: 'b' }
]

const RESOURCES: TestResource[] = [
  { id: 'topic-a', entityId: 'assistant-a', updatedAt: 2 },
  { id: 'topic-b', entityId: 'assistant-b', updatedAt: 1 }
]

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
        resources: RESOURCES,
        getResourceParentId: (resource) => resource.entityId,
        activeEntityId: 'assistant-a',
        isLoading: false,
        isError: false,
        onPickResource: vi.fn(),
        loadResourceForEntity: vi.fn(async (entityId) => {
          const matches = RESOURCES.filter((resource) => resource.entityId === entityId)
          return [...matches].sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null
        }),
        onCreateResource: vi.fn().mockResolvedValue(null),
        onActivationError: vi.fn(),
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
    const { result } = renderRail({ isLoading: true, resources: [] })

    expect(result.current.listStatus).toBe('loading')
    expect(result.current.items).toEqual([])
  })

  it('hides a brand-new entity that owns no resources while keeping the others shown', () => {
    const { result } = renderRail({
      entities: [...ENTITIES, { id: 'assistant-c', name: 'Assistant C', icon: 'C', orderKey: 'c' }],
      // assistant-c owns no resources yet; only a and b do.
      resources: RESOURCES
    })

    expect(result.current.items.map((item) => item.id)).toEqual(['assistant-a', 'assistant-b'])
  })

  it('updates selection while keeping the list mounted during loading', () => {
    const { result, rerender } = renderRail({ isLoading: true, activeEntityId: 'assistant-a' })

    expect(result.current.listStatus).toBe('idle')
    expect(result.current.selectedId).toBe('assistant-a')

    rerender({
      entities: ENTITIES,
      resources: RESOURCES,
      getResourceParentId: (resource) => resource.entityId,
      activeEntityId: 'assistant-b',
      isLoading: true,
      isError: false,
      onPickResource: vi.fn(),
      loadResourceForEntity: vi.fn(async (entityId) => {
        const matches = RESOURCES.filter((resource) => resource.entityId === entityId)
        return [...matches].sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null
      }),
      onCreateResource: vi.fn().mockResolvedValue(null),
      onActivationError: vi.fn(),
      reorder: vi.fn().mockResolvedValue(undefined),
      refetchEntities: vi.fn().mockResolvedValue(undefined),
      onReorderError: vi.fn()
    })

    expect(result.current.listStatus).toBe('idle')
    expect(result.current.selectedId).toBe('assistant-b')
    expect(result.current.items.map((item) => item.id)).toEqual(['assistant-a', 'assistant-b'])
  })

  it('enters the exact latest resource on select even when it is absent from the loaded list', async () => {
    const onPickResource = vi.fn()
    const serverLatest = { id: 'server-latest', entityId: 'assistant-a', updatedAt: 3 }
    const loadResourceForEntity = vi.fn().mockResolvedValue(serverLatest)
    const { result } = renderRail({ isLoading: true, loadResourceForEntity, onPickResource })

    await act(async () => {
      await result.current.handleSelect(ENTITIES[0])
    })

    expect(loadResourceForEntity).toHaveBeenCalledWith('assistant-a')
    expect(onPickResource).toHaveBeenCalledWith(serverLatest)
  })

  it('floats pinned entities to the top while preserving relative order of each partition', () => {
    const { result } = renderRail({
      entities: [
        { id: 'assistant-a', name: 'Assistant A', icon: 'A', orderKey: 'a' },
        { id: 'assistant-b', name: 'Assistant B', icon: 'B', orderKey: 'b', pinned: true },
        { id: 'assistant-c', name: 'Assistant C', icon: 'C', orderKey: 'c' }
      ],
      resources: [
        { id: 'topic-a', entityId: 'assistant-a', updatedAt: 3 },
        { id: 'topic-b', entityId: 'assistant-b', updatedAt: 2 },
        { id: 'topic-c', entityId: 'assistant-c', updatedAt: 1 }
      ]
    })

    expect(result.current.items.map((item) => item.id)).toEqual(['assistant-b', 'assistant-a', 'assistant-c'])
  })

  it('falls back to a blank resource when the exact lookup finds no resource', async () => {
    const created = { id: 'topic-created', entityId: 'assistant-c', updatedAt: 1 }
    const onCreateResource = vi.fn().mockResolvedValue(created)
    const onPickResource = vi.fn()
    const { result } = renderRail({
      loadResourceForEntity: vi.fn().mockResolvedValue(null),
      onCreateResource,
      onPickResource
    })

    await act(async () => {
      await result.current.handleSelect({ id: 'assistant-c', name: 'Assistant C', icon: 'C', orderKey: 'c' })
    })

    expect(onCreateResource).toHaveBeenCalledWith('assistant-c')
    expect(onPickResource).toHaveBeenCalledWith(created)
  })

  it('does not let an older owner lookup overwrite a newer selection', async () => {
    const first = createDeferred<TestResource | null>()
    const second = createDeferred<TestResource | null>()
    const onPickResource = vi.fn()
    const loadResourceForEntity = vi.fn((entityId: string) =>
      entityId === 'assistant-a' ? first.promise : second.promise
    )
    const { result } = renderRail({ loadResourceForEntity, onPickResource })

    let firstSelection!: Promise<void>
    let secondSelection!: Promise<void>
    await act(async () => {
      firstSelection = result.current.handleSelect(ENTITIES[0])
      secondSelection = result.current.handleSelect(ENTITIES[1])
      second.resolve(RESOURCES[1])
      await secondSelection
    })

    await act(async () => {
      first.resolve(RESOURCES[0])
      await firstSelection
    })

    expect(onPickResource).toHaveBeenCalledExactlyOnceWith(RESOURCES[1])
  })

  it('completes a pending owner lookup across an unrelated parent rerender', async () => {
    const latest = createDeferred<TestResource | null>()
    const onPickResource = vi.fn()
    const loadResourceForEntity = vi.fn(() => latest.promise)
    const { result, rerender } = renderRail({ loadResourceForEntity, onPickResource })

    let selection!: Promise<void>
    await act(async () => {
      selection = result.current.handleSelect(ENTITIES[0])
      await Promise.resolve()
    })

    rerender({
      entities: ENTITIES,
      resources: RESOURCES,
      getResourceParentId: (resource) => resource.entityId,
      activeEntityId: 'assistant-a',
      isLoading: false,
      isError: false,
      onPickResource,
      loadResourceForEntity,
      onCreateResource: vi.fn().mockResolvedValue(null),
      onActivationError: vi.fn(),
      reorder: vi.fn().mockResolvedValue(undefined),
      refetchEntities: vi.fn().mockResolvedValue(undefined),
      onReorderError: vi.fn()
    })

    await act(async () => {
      latest.resolve(RESOURCES[0])
      await selection
    })

    expect(onPickResource).toHaveBeenCalledExactlyOnceWith(RESOURCES[0])
  })

  it('does not let an older owner create overwrite a newer selection', async () => {
    const firstCreate = createDeferred<TestResource | null>()
    const onPickResource = vi.fn()
    const onCreateResource = vi.fn((entityId: string) =>
      entityId === 'assistant-a' ? firstCreate.promise : Promise.resolve(null)
    )
    const loadResourceForEntity = vi.fn((entityId: string) =>
      Promise.resolve(entityId === 'assistant-a' ? null : RESOURCES[1])
    )
    const { result } = renderRail({ loadResourceForEntity, onCreateResource, onPickResource })

    let firstSelection!: Promise<void>
    await act(async () => {
      firstSelection = result.current.handleSelect(ENTITIES[0])
      await Promise.resolve()
      await result.current.handleSelect(ENTITIES[1])
    })

    await act(async () => {
      firstCreate.resolve(RESOURCES[0])
      await firstSelection
    })

    expect(onPickResource).toHaveBeenCalledExactlyOnceWith(RESOURCES[1])
  })

  it('reports a current activation failure without rejecting the click handler', async () => {
    const error = new Error('latest lookup failed')
    const onActivationError = vi.fn()
    const { result } = renderRail({
      loadResourceForEntity: vi.fn().mockRejectedValue(error),
      onActivationError
    })

    await act(async () => {
      await expect(result.current.handleSelect(ENTITIES[0])).resolves.toBeUndefined()
    })

    expect(onActivationError).toHaveBeenCalledExactlyOnceWith(error)
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
