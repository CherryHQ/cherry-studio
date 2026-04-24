import { loggerService } from '@logger'
import type { Pin } from '@shared/data/types/pin'
import { MockUseDataApiUtils, mockUseMutation, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { usePinnedEntityIds } from '../usePinnedEntityIds'

const ASSISTANT_PIN: Pin = {
  id: '11111111-1111-4111-8111-111111111111',
  entityType: 'assistant',
  entityId: '22222222-2222-4222-8222-222222222222',
  orderKey: 'a0',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const STALE_MODEL_PIN: Pin = {
  id: '33333333-3333-4333-8333-333333333333',
  entityType: 'model',
  entityId: 'openai::gpt-4',
  orderKey: 'b0',
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

function wireMutations(overrides?: {
  postTrigger?: ReturnType<typeof vi.fn>
  deleteTrigger?: ReturnType<typeof vi.fn>
}) {
  const postTrigger = overrides?.postTrigger ?? vi.fn(async () => ASSISTANT_PIN)
  const deleteTrigger = overrides?.deleteTrigger ?? vi.fn(async () => undefined)

  mockUseMutation.mockImplementation((method: string, path: string) => {
    if (method === 'POST' && path === '/pins') {
      return { trigger: postTrigger, isLoading: false, error: undefined }
    }
    if (method === 'DELETE' && path === '/pins/:id') {
      return { trigger: deleteTrigger, isLoading: false, error: undefined }
    }
    return { trigger: vi.fn(), isLoading: false, error: undefined }
  })

  return { postTrigger, deleteTrigger }
}

describe('usePinnedEntityIds', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
  })

  it('passes the configured entityType through to the /pins query', () => {
    wirePins([ASSISTANT_PIN])
    wireMutations()

    renderHook(() => usePinnedEntityIds('assistant'))

    expect(mockUseQuery).toHaveBeenCalledWith('/pins', { query: { entityType: 'assistant' } })
  })

  it('narrows pins to the requested entityType branch, dropping foreign-type rows', () => {
    // Defense-in-depth: even if the endpoint leaks rows of another type, the
    // hook only exposes ids matching the requested entityType.
    wirePins([ASSISTANT_PIN, STALE_MODEL_PIN])
    wireMutations()

    const { result } = renderHook(() => usePinnedEntityIds('assistant'))

    expect(result.current.pinnedIds).toEqual([ASSISTANT_PIN.entityId])
  })

  it('creates a pin with the configured entityType literal in the POST body', async () => {
    wirePins([])
    const { postTrigger } = wireMutations()

    const { result } = renderHook(() => usePinnedEntityIds('assistant'))

    const newId = '99999999-9999-4999-8999-999999999999'
    await act(async () => {
      await result.current.togglePin(newId)
    })

    expect(postTrigger).toHaveBeenCalledWith({
      body: { entityType: 'assistant', entityId: newId }
    })
  })

  it('blocks toggling while a background refresh is running to avoid stale-snapshot races', async () => {
    // Revalidation may be importing another window's pin/unpin. Acting on the
    // pre-refresh `pinByEntityId` snapshot could emit a DELETE with a stale id
    // (404) or a redundant POST, so the hook gates on `isRefreshing` too.
    wirePins([], { isRefreshing: true })
    const { postTrigger, deleteTrigger } = wireMutations()

    const { result } = renderHook(() => usePinnedEntityIds('assistant'))

    await act(async () => {
      await result.current.togglePin('44444444-4444-4444-8444-444444444444')
    })

    expect(postTrigger).not.toHaveBeenCalled()
    expect(deleteTrigger).not.toHaveBeenCalled()
    // Background refresh is surfaced via isLoading for UI callers.
    expect(result.current.isLoading).toBe(true)
  })

  it('swallows mutation errors and routes them to loggerService.error', async () => {
    wirePins([])
    const postTrigger = vi.fn(async () => {
      throw new Error('backend down')
    })
    wireMutations({ postTrigger })
    // Spy on the root loggerService.error — the hook's context logger is the
    // same singleton under our renderer mock, but binding to the singleton
    // method directly keeps the test independent of that mock detail.
    const errorSpy = vi.spyOn(loggerService, 'error').mockImplementation(() => {})

    const { result } = renderHook(() => usePinnedEntityIds('assistant'))

    await act(async () => {
      await result.current.togglePin('55555555-5555-4555-8555-555555555555')
    })

    expect(errorSpy).toHaveBeenCalled()
  })
})
