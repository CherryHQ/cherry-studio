import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComposerDraft } from '../../model/composerDraft'
import { usePaintingModelSwitch } from '../usePaintingModelSwitch'

const { mockComputeReset } = vi.hoisted(() => ({ mockComputeReset: vi.fn() }))
vi.mock('../../utils/computeModelFieldReset', () => ({ computeModelFieldReset: mockComputeReset }))

const makeDraft = (overrides: Partial<ComposerDraft> = {}): ComposerDraft => ({
  sessionId: 'sess-1',
  providerId: 'openai',
  model: 'old-model',
  mode: 'generate',
  prompt: 'a cat',
  params: { size: '1024x1024' },
  inputFiles: [],
  ...overrides
})

describe('usePaintingModelSwitch', () => {
  beforeEach(() => mockComputeReset.mockReset())

  // The decoupling contract: a model switch patches model/params only — never the
  // inputFiles or the sessionId. That is what stops the composer from remounting and
  // dropping attached images (the PR1.5 bug).
  it('same provider: patches model + merged param reset, leaves inputFiles/sessionId alone', async () => {
    mockComputeReset.mockResolvedValue({ size: '512x512' })
    const onDraftChange = vi.fn()
    const ensureProviderCatalog = vi.fn().mockResolvedValue([])

    const { result } = renderHook(() =>
      usePaintingModelSwitch({ draft: makeDraft(), onDraftChange, ensureProviderCatalog })
    )
    await act(async () => {
      await result.current({ providerId: 'openai', modelId: 'new-model' })
    })

    expect(ensureProviderCatalog).not.toHaveBeenCalled()
    const patch = onDraftChange.mock.calls[0][0]
    expect(patch).toEqual({ model: 'new-model', params: { size: '512x512' } })
    expect(patch).not.toHaveProperty('inputFiles')
    expect(patch).not.toHaveProperty('sessionId')
  })

  it('cross provider: patches providerId + model + reset params, leaves inputFiles/sessionId alone', async () => {
    const onDraftChange = vi.fn()
    const ensureProviderCatalog = vi.fn().mockResolvedValue([])

    const { result } = renderHook(() =>
      usePaintingModelSwitch({ draft: makeDraft(), onDraftChange, ensureProviderCatalog })
    )
    await act(async () => {
      await result.current({ providerId: 'zhipu', modelId: 'cogview' })
    })

    expect(ensureProviderCatalog).toHaveBeenCalledWith('zhipu')
    expect(mockComputeReset).not.toHaveBeenCalled()
    const patch = onDraftChange.mock.calls[0][0]
    expect(patch).toEqual({ providerId: 'zhipu', model: 'cogview', params: {} })
    expect(patch).not.toHaveProperty('inputFiles')
    expect(patch).not.toHaveProperty('sessionId')
  })
})
