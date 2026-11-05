import { MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import { MockUseDataApiUtils, mockUseMutation, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Tag } from '@shared/data/types/tag'

import { useEntityTags } from '../useTags'

const WORK_TAG: Tag = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'work',
  color: '#ff0000',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

function wireQueries() {
  const refetchTags = vi.fn()
  const refetchBindings = vi.fn()
  mockUseQuery.mockImplementation((path: string, queryOptions?: { enabled?: boolean }) => {
    const enabled = queryOptions?.enabled !== false
    if (path === '/tags') {
      return {
        data: enabled ? [WORK_TAG] : undefined,
        isLoading: false,
        error: undefined,
        refetch: refetchTags,
        mutate: vi.fn()
      }
    }
    if (path === '/entity-tags') {
      return {
        data: enabled ? [{ entityId: 'assistant-1', tagId: WORK_TAG.id }] : undefined,
        isLoading: false,
        error: undefined,
        refetch: refetchBindings,
        mutate: vi.fn()
      }
    }
    return { data: undefined, isLoading: false, error: undefined, refetch: vi.fn(), mutate: vi.fn() }
  })
  mockUseMutation.mockImplementation(() => ({ trigger: vi.fn(), isLoading: false, error: undefined }))
  return { refetchTags, refetchBindings }
}

describe('useEntityTags', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
    MockDataApiUtils.resetMocks()
  })

  it('refetches bindings when another window changes entity-tag data', () => {
    const { refetchTags, refetchBindings } = wireQueries()
    renderHook(() => useEntityTags('assistant'))

    act(() => {
      MockUseDataApiUtils.emitDataChange([{ endpoint: '/entity-tags', kind: 'membership' }])
    })

    // The mutation-driven refresh covers only the initiating window; a
    // data-change notification refetches the bindings in this one. The tag
    // list itself is untouched by a membership change.
    expect(refetchBindings).toHaveBeenCalledTimes(1)
    expect(refetchTags).not.toHaveBeenCalled()
  })

  it('skips the change subscription when disabled', () => {
    wireQueries()
    renderHook(() => useEntityTags('assistant', { enabled: false }))

    expect(MockDataApiUtils.getCurrentState().dataChangeListeners.has('/entity-tags')).toBe(false)
  })
})
