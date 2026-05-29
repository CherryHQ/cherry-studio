import type { Pin } from '@shared/data/types/pin'
import { MockUseDataApiUtils, mockUseMutation, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { usePins } from '../usePins'

const ASSISTANT_PIN: Pin = {
  id: '11111111-1111-4111-8111-111111111111',
  entityType: 'assistant',
  entityId: '22222222-2222-4222-8222-222222222222',
  orderKey: 'a0',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const MODEL_PIN_A: Pin = {
  id: '33333333-3333-4333-8333-333333333333',
  entityType: 'model',
  entityId: 'openai::gpt-4',
  orderKey: 'a0',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const MODEL_PIN_B: Pin = {
  id: '44444444-4444-4444-8444-444444444444',
  entityType: 'model',
  entityId: 'anthropic::claude-3-opus',
  orderKey: 'a1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

function wirePins(pins: Pin[], options: { isLoading?: boolean; isRefreshing?: boolean; error?: Error } = {}) {
  const refetch = vi.fn()
  mockUseQuery.mockImplementation((path: string) => {
    if (path === '/pins') {
      return {
        data: pins,
        isLoading: options.isLoading ?? false,
        isRefreshing: options.isRefreshing ?? false,
        error: options.error,
        refetch,
        mutate: vi.fn()
      }
    }

    return {
      data: undefined,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn().mockResolvedValue(undefined),
      mutate: vi.fn()
    }
  })

  return refetch
}

function wireMutations(overrides?: {
  postTrigger?: ReturnType<typeof vi.fn>
  deleteTrigger?: ReturnType<typeof vi.fn>
  postError?: Error
  deleteError?: Error
  isCreating?: boolean
  isDeleting?: boolean
}) {
  const postTrigger = overrides?.postTrigger ?? vi.fn(async () => MODEL_PIN_A)
  const deleteTrigger = overrides?.deleteTrigger ?? vi.fn(async () => undefined)

  mockUseMutation.mockImplementation((method: string, path: string, options?: { refresh?: unknown }) => {
    if (method === 'POST' && path === '/pins') {
      expect(options?.refresh).toEqual(['/pins'])
      return {
        trigger: postTrigger,
        isLoading: overrides?.isCreating ?? false,
        error: overrides?.postError
      }
    }
    if (method === 'DELETE' && path === '/pins/:id') {
      expect(options?.refresh).toEqual(['/pins'])
      return {
        trigger: deleteTrigger,
        isLoading: overrides?.isDeleting ?? false,
        error: overrides?.deleteError
      }
    }
    return { trigger: vi.fn(), isLoading: false, error: undefined }
  })

  return { postTrigger, deleteTrigger }
}

describe('usePins', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
  })

  it('passes the configured entityType through to the /pins query', () => {
    wirePins([MODEL_PIN_A])
    wireMutations()

    renderHook(() => usePins('model'))

    expect(mockUseQuery).toHaveBeenCalledWith('/pins', { query: { entityType: 'model' } })
  })

  it('narrows returned pins to the requested entityType and preserves API order', () => {
    wirePins([ASSISTANT_PIN, MODEL_PIN_B, MODEL_PIN_A])
    wireMutations()

    const { result } = renderHook(() => usePins('model'))

    expect(result.current.pinnedIds).toEqual(['anthropic::claude-3-opus', 'openai::gpt-4'])
  })

  it('creates a pin with the configured entityType literal in the POST body', async () => {
    wirePins([])
    const { postTrigger } = wireMutations()

    const { result } = renderHook(() => usePins('model'))

    await act(async () => {
      await result.current.togglePin('anthropic::claude-3-opus')
    })

    expect(postTrigger).toHaveBeenCalledWith({
      body: { entityType: 'model', entityId: 'anthropic::claude-3-opus' }
    })
  })

  it('unpins an existing entity through DELETE /pins/:id with the pin row id', async () => {
    wirePins([MODEL_PIN_A, MODEL_PIN_B])
    const { deleteTrigger } = wireMutations()

    const { result } = renderHook(() => usePins('model'))

    await act(async () => {
      await result.current.togglePin('openai::gpt-4')
    })

    expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: MODEL_PIN_A.id } })
  })

  it('blocks toggling while a background refresh is running to avoid stale-snapshot races', async () => {
    const consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    wirePins([], { isRefreshing: true })
    const { postTrigger, deleteTrigger } = wireMutations()

    const { result } = renderHook(() => usePins('model'))

    await act(async () => {
      await result.current.togglePin('openai::gpt-4')
    })

    expect(postTrigger).not.toHaveBeenCalled()
    expect(deleteTrigger).not.toHaveBeenCalled()
    expect(result.current.isRefreshing).toBe(true)
    expect(consoleDebugSpy).toHaveBeenCalledWith(
      'togglePin gated',
      expect.objectContaining({
        entityType: 'model',
        entityId: 'openai::gpt-4',
        isRefreshing: true
      })
    )
    consoleDebugSpy.mockRestore()
  })

  it('rejects mutation errors so callers can log and show feedback', async () => {
    wirePins([])
    const postTrigger = vi.fn(async () => {
      throw new Error('backend down')
    })
    wireMutations({ postTrigger })

    const { result } = renderHook(() => usePins('model'))

    await expect(result.current.togglePin('openai::gpt-4')).rejects.toThrow('backend down')
  })

  it('surfaces query and mutation loading/error states separately', () => {
    const queryError = new Error('query failed')
    wirePins([], { isLoading: true, isRefreshing: true, error: queryError })
    wireMutations({ isCreating: true, postError: new Error('create failed') })

    const { result } = renderHook(() => usePins('model'))

    expect(result.current.isLoading).toBe(true)
    expect(result.current.isRefreshing).toBe(true)
    expect(result.current.isMutating).toBe(true)
    expect(result.current.error).toBe(queryError)
  })

  it('logs query errors via logger so /pins read failures are not silent', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const queryError = new Error('query failed')
    wirePins([], { error: queryError })
    wireMutations()

    renderHook(() => usePins('model'))

    expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to read pins', queryError, { entityType: 'model' })
    consoleErrorSpy.mockRestore()
  })
})
