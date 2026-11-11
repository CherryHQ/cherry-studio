import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { PaintingData } from '../../model/types/paintingData'
import { usePaintingModelSwitch } from '../usePaintingModelSwitch'

vi.mock('@renderer/hooks/useModel', () => ({ useModels: () => ({ models: [] }) }))
vi.mock('../../utils/computeModelFieldReset', () => ({ computeModelFieldReset: async () => ({}) }))

const initial: PaintingData = {
  id: 'draft',
  providerId: 'ppio',
  mode: 'generate',
  model: 'old',
  prompt: 'prompt',
  files: [],
  params: {}
}

function setup(painting: PaintingData) {
  return renderHook(() => {
    const [draft, setDraft] = useState(painting)
    const switchModel = usePaintingModelSwitch({
      painting: draft,
      onPaintingChange: (updates) => setDraft((current) => ({ ...current, ...updates })),
      ensureProviderCatalog: async () => []
    })
    return { draft, switchModel }
  })
}

describe('usePaintingModelSwitch', () => {
  it('clears an override when switching providers', async () => {
    const { result } = setup({ ...initial, requestTimeoutMs: 900_000 })
    await act(() => result.current.switchModel({ providerId: 'dashscope', modelId: 'new' }))
    expect(result.current.draft.providerId).toBe('dashscope')
    expect(result.current.draft.requestTimeoutMs).toBeUndefined()
  })

  it('keeps an override when switching models within a provider', async () => {
    const { result } = setup({ ...initial, requestTimeoutMs: 900_000 })
    await act(() => result.current.switchModel({ providerId: 'ppio', modelId: 'new' }))
    expect(result.current.draft.model).toBe('new')
    expect(result.current.draft.requestTimeoutMs).toBe(900_000)
  })

  it('leaves the override absent when switching providers without one', async () => {
    const { result } = setup(initial)
    await act(() => result.current.switchModel({ providerId: 'dashscope', modelId: 'new' }))
    expect(result.current.draft.providerId).toBe('dashscope')
    expect(result.current.draft.requestTimeoutMs).toBeUndefined()
  })
})
