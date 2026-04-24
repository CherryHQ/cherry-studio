import type { Pin } from '@shared/data/types/pin'
import { MockUseDataApiUtils, mockUseMutation, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { usePinnedModelIds } from '../usePinnedModelIds'

const PIN_A: Pin = {
  id: '11111111-1111-4111-8111-111111111111',
  entityType: 'model',
  entityId: 'openai::gpt-4',
  orderKey: 'a0',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const PIN_B: Pin = {
  id: '22222222-2222-4222-8222-222222222222',
  entityType: 'model',
  entityId: 'anthropic::claude-3-opus',
  orderKey: 'a1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

function wirePins(pins: Pin[], options: { isLoading?: boolean; isRefreshing?: boolean } = {}) {
  const refetch = vi.fn()
  mockUseQuery.mockImplementation((path: string) => {
    if (path === '/pins') {
      return {
        data: pins,
        isLoading: options.isLoading ?? false,
        isRefreshing: options.isRefreshing ?? false,
        error: undefined,
        refetch,
        mutate: vi.fn()
      }
    }

    return {
      data: undefined,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn(),
      mutate: vi.fn()
    }
  })

  return refetch
}

function wireMutations() {
  const postTrigger = vi.fn(async () => PIN_A)
  const deleteTrigger = vi.fn(async () => undefined)

  mockUseMutation.mockImplementation((method: string, path: string, options?: { refresh?: unknown }) => {
    if (method === 'POST' && path === '/pins') {
      expect(options?.refresh).toEqual(['/pins'])
      return { trigger: postTrigger, isLoading: false, error: undefined }
    }

    if (method === 'DELETE' && path === '/pins/:id') {
      expect(options?.refresh).toEqual(['/pins'])
      return { trigger: deleteTrigger, isLoading: false, error: undefined }
    }

    return { trigger: vi.fn(), isLoading: false, error: undefined }
  })

  return { postTrigger, deleteTrigger }
}

describe('usePinnedModelIds', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
  })

  it('reads model pins from the /pins DataApi endpoint in order', () => {
    wirePins([PIN_B, PIN_A])
    wireMutations()

    const { result } = renderHook(() => usePinnedModelIds())

    expect(mockUseQuery).toHaveBeenCalledWith('/pins', { query: { entityType: 'model' } })
    expect(result.current.pinnedIds).toEqual(['anthropic::claude-3-opus', 'openai::gpt-4'])
  })

  it('pins an unpinned model through POST /pins', async () => {
    wirePins([PIN_A])
    const { postTrigger } = wireMutations()

    const { result } = renderHook(() => usePinnedModelIds())

    await act(async () => {
      await result.current.togglePin('anthropic::claude-3-opus')
    })

    expect(postTrigger).toHaveBeenCalledWith({
      body: { entityType: 'model', entityId: 'anthropic::claude-3-opus' }
    })
  })

  it('unpins an existing model through DELETE /pins/:id with the pin row id', async () => {
    wirePins([PIN_A, PIN_B])
    const { deleteTrigger } = wireMutations()

    const { result } = renderHook(() => usePinnedModelIds())

    await act(async () => {
      await result.current.togglePin('openai::gpt-4')
    })

    expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: PIN_A.id } })
  })

  it('exposes the /pins refetch callback for on-demand freshness', () => {
    const refetch = wirePins([PIN_A])
    wireMutations()

    const { result } = renderHook(() => usePinnedModelIds())
    result.current.refetch()

    expect(refetch).toHaveBeenCalled()
  })

  it('does not mutate while pin state is still loading', async () => {
    wirePins([], { isLoading: true })
    const { postTrigger, deleteTrigger } = wireMutations()

    const { result } = renderHook(() => usePinnedModelIds())

    await act(async () => {
      await result.current.togglePin('openai::gpt-4')
    })

    expect(result.current.isLoading).toBe(true)
    expect(postTrigger).not.toHaveBeenCalled()
    expect(deleteTrigger).not.toHaveBeenCalled()
  })
})
