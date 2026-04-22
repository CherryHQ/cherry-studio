import type { Model } from '@shared/data/types/model'
import { mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { mockUsePreference, MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { usePinnedModelIds } from '../usePinnedModelIds'

// mockUsePreference does not re-render consumers when state changes (no subscription),
// so toggle-style tests bypass state and assert on the set() spy directly.
function wirePreference(stored: string[]) {
  const setSpy = vi.fn(async () => {
    /* spy only */
  })
  mockUsePreference.mockImplementation(((key: string) => {
    if (key === 'app.model.pinned_ids') return [stored, setSpy]
    return [null, vi.fn()]
  }) as unknown as typeof mockUsePreference)
  return setSpy
}

function mockModelsData(ids: string[], loading = false) {
  mockUseQuery.mockImplementation(() => ({
    data: loading ? undefined : ids.map((id) => ({ id }) as unknown as Model),
    isLoading: loading,
    isRefreshing: false,
    error: undefined,
    refetch: vi.fn(),
    mutate: vi.fn()
  }))
}

describe('usePinnedModelIds', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
    mockUseQuery.mockReset()
  })

  it('returns stored ids verbatim when all are valid UniqueModelIds', () => {
    wirePreference(['openai::gpt-4', 'anthropic::claude-3-opus'])
    mockModelsData(['openai::gpt-4', 'anthropic::claude-3-opus'])

    const { result } = renderHook(() => usePinnedModelIds())

    expect(result.current.pinnedIds).toEqual(['openai::gpt-4', 'anthropic::claude-3-opus'])
  })

  it('dedupes duplicate entries in storage', () => {
    wirePreference(['openai::gpt-4', 'openai::gpt-4', 'anthropic::claude-3-opus'])
    mockModelsData(['openai::gpt-4', 'anthropic::claude-3-opus'])

    const { result } = renderHook(() => usePinnedModelIds())

    expect(result.current.pinnedIds).toEqual(['openai::gpt-4', 'anthropic::claude-3-opus'])
  })

  it('normalizes legacy JSON format (v1 getModelUniqId output)', () => {
    wirePreference(['{"id":"gpt-4","provider":"openai"}', '{"id":"claude-3-opus","provider":"anthropic"}'])
    mockModelsData(['openai::gpt-4', 'anthropic::claude-3-opus'])

    const { result } = renderHook(() => usePinnedModelIds())

    expect(result.current.pinnedIds).toEqual(['openai::gpt-4', 'anthropic::claude-3-opus'])
  })

  it('normalizes legacy provider/modelId slash format', () => {
    wirePreference(['openai/gpt-4', 'anthropic/claude-3-opus'])
    mockModelsData(['openai::gpt-4', 'anthropic::claude-3-opus'])

    const { result } = renderHook(() => usePinnedModelIds())

    expect(result.current.pinnedIds).toEqual(['openai::gpt-4', 'anthropic::claude-3-opus'])
  })

  it('drops empty/invalid entries and keeps the rest', () => {
    wirePreference(['', 'openai::gpt-4', 'no-separator', 'anthropic::claude-3-opus'])
    mockModelsData(['openai::gpt-4', 'anthropic::claude-3-opus'])

    const { result } = renderHook(() => usePinnedModelIds())

    expect(result.current.pinnedIds).toEqual(['openai::gpt-4', 'anthropic::claude-3-opus'])
  })

  it('writes back normalized list when stored legacy data differs from normalized', async () => {
    const setSpy = wirePreference(['{"id":"gpt-4","provider":"openai"}'])
    mockModelsData(['openai::gpt-4'])

    renderHook(() => usePinnedModelIds())

    await waitFor(() => {
      expect(setSpy).toHaveBeenCalledWith(['openai::gpt-4'])
    })
  })

  it('does not write back when stored data already matches normalized form', async () => {
    const setSpy = wirePreference(['openai::gpt-4'])
    mockModelsData(['openai::gpt-4'])

    renderHook(() => usePinnedModelIds())

    // let effects flush
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(setSpy).not.toHaveBeenCalled()
  })

  it('prunes orphan ids once models finish loading', async () => {
    const setSpy = wirePreference(['openai::gpt-4', 'anthropic::deleted-model'])
    mockModelsData(['openai::gpt-4']) // deleted-model no longer exists

    renderHook(() => usePinnedModelIds())

    await waitFor(() => {
      expect(setSpy).toHaveBeenCalledWith(['openai::gpt-4'])
    })
  })

  it('does not prune while models are still loading', async () => {
    const setSpy = wirePreference(['openai::gpt-4', 'anthropic::claude-3-opus'])
    mockModelsData([], true) // loading

    renderHook(() => usePinnedModelIds())
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Stored values were already normalized form → neither effect should fire.
    expect(setSpy).not.toHaveBeenCalled()
  })

  it('togglePin adds a new id at the tail', async () => {
    const setSpy = wirePreference(['openai::gpt-4'])
    mockModelsData(['openai::gpt-4', 'anthropic::claude-3-opus'])

    const { result } = renderHook(() => usePinnedModelIds())

    await act(async () => {
      await result.current.togglePin('anthropic::claude-3-opus')
    })

    expect(setSpy).toHaveBeenCalledWith(['openai::gpt-4', 'anthropic::claude-3-opus'])
  })

  it('togglePin removes an existing id', async () => {
    const setSpy = wirePreference(['openai::gpt-4', 'anthropic::claude-3-opus'])
    mockModelsData(['openai::gpt-4', 'anthropic::claude-3-opus'])

    const { result } = renderHook(() => usePinnedModelIds())

    await act(async () => {
      await result.current.togglePin('openai::gpt-4')
    })

    expect(setSpy).toHaveBeenCalledWith(['anthropic::claude-3-opus'])
  })
})
