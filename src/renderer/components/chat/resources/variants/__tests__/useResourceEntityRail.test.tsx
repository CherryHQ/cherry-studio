import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useResourceEntityRail } from '../useResourceEntityRail'

type TestEntity = {
  id: string
  name: string
  icon: string
  orderKey?: string
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

function renderRail(overrides: Partial<Parameters<typeof useResourceEntityRail<TestEntity, TestResource>>[0]> = {}) {
  return renderHook(
    (props: Parameters<typeof useResourceEntityRail<TestEntity, TestResource>>[0]) => useResourceEntityRail(props),
    {
      initialProps: {
        entities: ENTITIES,
        resources: RESOURCES,
        getResourceParentId: (resource) => resource.entityId,
        resourcesFullyLoaded: true,
        activeEntityId: 'assistant-a',
        isLoading: false,
        isError: false,
        sortResourcesForEntity: (resources) => [...resources].sort((a, b) => b.updatedAt - a.updatedAt),
        onPickResource: vi.fn(),
        onStartDraft: vi.fn(),
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

  it('updates selection while keeping the list mounted during loading', () => {
    const { result, rerender } = renderRail({ isLoading: true, activeEntityId: 'assistant-a' })

    expect(result.current.listStatus).toBe('idle')
    expect(result.current.selectedId).toBe('assistant-a')

    rerender({
      entities: ENTITIES,
      resources: RESOURCES,
      getResourceParentId: (resource) => resource.entityId,
      resourcesFullyLoaded: true,
      activeEntityId: 'assistant-b',
      isLoading: true,
      isError: false,
      sortResourcesForEntity: (resources) => [...resources].sort((a, b) => b.updatedAt - a.updatedAt),
      onPickResource: vi.fn(),
      onStartDraft: vi.fn(),
      reorder: vi.fn().mockResolvedValue(undefined),
      refetchEntities: vi.fn().mockResolvedValue(undefined),
      onReorderError: vi.fn()
    })

    expect(result.current.listStatus).toBe('idle')
    expect(result.current.selectedId).toBe('assistant-b')
    expect(result.current.items.map((item) => item.id)).toEqual(['assistant-a', 'assistant-b'])
  })
})
