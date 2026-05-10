import { dataApiService } from '@data/DataApiService'
import { DataApiErrorFactory, ErrorCode } from '@shared/data/api'
import type { Tag } from '@shared/data/types/tag'
import { MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import { MockUseDataApiUtils, mockUseMutation, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useEnsureTags, useTagList } from '../useTags'

function tag(id: string, name: string, color = '#3b82f6'): Tag {
  return {
    id,
    name,
    color,
    createdAt: '2026-05-10T00:00:00.000Z',
    updatedAt: '2026-05-10T00:00:00.000Z'
  }
}

function mockTagQuery(tags: Tag[], options: { isLoading?: boolean; error?: Error } = {}) {
  const refetch = vi.fn().mockResolvedValue(undefined)
  mockUseQuery.mockImplementation((path: string) => {
    if (path === '/tags') {
      return {
        data: tags,
        isLoading: options.isLoading ?? false,
        isRefreshing: false,
        error: options.error,
        refetch,
        mutate: vi.fn().mockResolvedValue(tags)
      }
    }

    return {
      data: undefined,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn().mockResolvedValue(undefined),
      mutate: vi.fn().mockResolvedValue(undefined)
    }
  })
  return refetch
}

function mockCreateTag(trigger: ReturnType<typeof vi.fn>) {
  mockUseMutation.mockImplementation((method, path, options) => {
    if (method === 'POST' && path === '/tags') {
      expect(options?.refresh).toEqual(['/tags'])
      return {
        trigger,
        isLoading: false,
        error: undefined
      }
    }

    return {
      trigger: vi.fn().mockResolvedValue({}),
      isLoading: false,
      error: undefined
    }
  })
}

describe('useTags', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
    MockDataApiUtils.resetMocks()
  })

  describe('useTagList', () => {
    it('exposes /tags data and keeps refetch fire-and-forget', () => {
      const work = tag('tag-1', 'work')
      const refetch = mockTagQuery([work])

      const { result } = renderHook(() => useTagList())

      expect(mockUseQuery).toHaveBeenCalledWith('/tags')
      expect(result.current.tags).toEqual([work])
      expect(result.current.isLoading).toBe(false)

      result.current.refetch()
      expect(refetch).toHaveBeenCalledTimes(1)
    })
  })

  describe('useEnsureTags', () => {
    it('returns cache hits without posting', async () => {
      const work = tag('tag-1', 'work')
      mockTagQuery([work])
      const createTrigger = vi.fn()
      mockCreateTag(createTrigger)

      const { result } = renderHook(() => useEnsureTags())

      await expect(result.current.ensureTags(['work'])).resolves.toEqual([work])
      expect(createTrigger).not.toHaveBeenCalled()
    })

    it('skips empty names and de-duplicates by first non-empty occurrence', async () => {
      const created = tag('tag-2', 'new', '#ef4444')
      mockTagQuery([])
      const createTrigger = vi.fn().mockResolvedValue(created)
      mockCreateTag(createTrigger)

      const { result } = renderHook(() => useEnsureTags())

      await expect(
        result.current.ensureTags(['', '  ', { name: 'new', color: '#ef4444' }, { name: 'new', color: '#22c55e' }])
      ).resolves.toEqual([created])

      expect(createTrigger).toHaveBeenCalledTimes(1)
      expect(createTrigger).toHaveBeenCalledWith({ body: { name: 'new', color: '#ef4444' } })
    })

    it('uses default color when creating a tag without an explicit color', async () => {
      const created = tag('tag-3', 'design', '#0ea5e9')
      mockTagQuery([])
      const createTrigger = vi.fn().mockResolvedValue(created)
      mockCreateTag(createTrigger)

      const { result } = renderHook(() => useEnsureTags({ getDefaultColor: () => '#0ea5e9' }))

      await expect(result.current.ensureTags(['design'])).resolves.toEqual([created])
      expect(createTrigger).toHaveBeenCalledWith({ body: { name: 'design', color: '#0ea5e9' } })
    })

    it('resolves CONFLICT races through an imperative /tags read', async () => {
      const fresh = tag('tag-4', 'race')
      mockTagQuery([])
      const conflict = DataApiErrorFactory.create(ErrorCode.CONFLICT)
      const createTrigger = vi.fn().mockRejectedValue(conflict)
      mockCreateTag(createTrigger)
      MockDataApiUtils.setCustomResponse('/tags', 'GET', [fresh])

      const { result } = renderHook(() => useEnsureTags())

      await expect(result.current.ensureTags(['race'])).resolves.toEqual([fresh])
      expect(dataApiService.get).toHaveBeenCalledWith('/tags')
    })

    it('rethrows the original CONFLICT when the imperative read misses', async () => {
      mockTagQuery([])
      const conflict = DataApiErrorFactory.create(ErrorCode.CONFLICT)
      const createTrigger = vi.fn().mockRejectedValue(conflict)
      mockCreateTag(createTrigger)
      MockDataApiUtils.setCustomResponse('/tags', 'GET', [])

      const { result } = renderHook(() => useEnsureTags())

      await expect(result.current.ensureTags(['missing'])).rejects.toBe(conflict)
      expect(dataApiService.get).toHaveBeenCalledWith('/tags')
    })

    it('rethrows non-CONFLICT creation errors without imperative lookup', async () => {
      mockTagQuery([])
      const validation = DataApiErrorFactory.create(ErrorCode.VALIDATION_ERROR)
      const createTrigger = vi.fn().mockRejectedValue(validation)
      mockCreateTag(createTrigger)

      const { result } = renderHook(() => useEnsureTags())

      await expect(result.current.ensureTags(['bad'])).rejects.toBe(validation)
      expect(dataApiService.get).not.toHaveBeenCalled()
    })

    it('returns an empty list for all-empty input without posting', async () => {
      mockTagQuery([])
      const createTrigger = vi.fn()
      mockCreateTag(createTrigger)

      const { result } = renderHook(() => useEnsureTags())

      await act(async () => {
        await expect(result.current.ensureTags([' ', { name: '\t' }])).resolves.toEqual([])
      })

      expect(createTrigger).not.toHaveBeenCalled()
    })
  })
})
