import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PaintingData } from '../../model/types/paintingData'
import { usePaintingModelSwitch } from '../usePaintingModelSwitch'
import { usePaintingSession } from '../usePaintingSession'

const { resetFields } = vi.hoisted(() => ({ resetFields: vi.fn() }))
vi.mock('@renderer/hooks/useModel', () => ({ useModels: () => ({ models: [] }) }))
vi.mock('../../utils/computeModelFieldReset', () => ({ computeModelFieldReset: resetFields }))
const original: PaintingData = {
  id: 'original',
  providerId: 'openai',
  model: 'old',
  mode: 'generate',
  prompt: 'Original',
  files: [],
  params: {}
}

describe('model switches belong to the initiating editor action', () => {
  beforeEach(() => {
    resetFields.mockResolvedValue({})
  })
  it.each(['openai', 'silicon'])('ignores a delayed %s model selection after navigating away', async (providerId) => {
    let release!: () => void
    const wait = new Promise<void>((resolve) => {
      release = resolve
    })
    resetFields.mockImplementationOnce(async () => {
      await wait
      return {}
    })
    const { result } = renderHook(() => {
      const session = usePaintingSession(() => original)
      const switchModel = usePaintingModelSwitch({
        painting: session.painting,
        bindPaintingChange: session.bindEdit,
        ensureProviderCatalog: async () => {
          await wait
          return []
        }
      })
      return { session, switchModel }
    })
    let pending!: Promise<void>
    act(() => {
      pending = result.current.switchModel({ providerId, modelId: 'new-model' })
    })
    const next = { ...original, id: 'new-draft', prompt: '' }
    act(() => {
      result.current.session.replace(next)
    })
    await act(async () => {
      release()
      await pending
    })
    expect(result.current.session.painting).toBe(next)
  })
  it('applies a model selection without overwriting concurrently generated output or prompt', async () => {
    let release!: () => void
    const wait = new Promise<void>((resolve) => {
      release = resolve
    })
    const { result } = renderHook(() => {
      const session = usePaintingSession(() => original)
      const switchModel = usePaintingModelSwitch({
        painting: session.painting,
        bindPaintingChange: session.bindEdit,
        ensureProviderCatalog: async () => {
          await wait
          return []
        }
      })
      return { session, switchModel }
    })
    const applyGeneration = result.current.session.bindGeneration()
    let pending!: Promise<void>
    act(() => {
      pending = result.current.switchModel({ providerId: 'silicon', modelId: 'new-model' })
    })
    act(() => {
      applyGeneration({ ...original, id: 'generated', files: [{ id: 'output' } as PaintingData['files'][number]] })
    })
    await act(async () => {
      release()
      await pending
    })
    expect(result.current.session.painting).toMatchObject({
      id: 'generated',
      prompt: 'Original',
      files: [{ id: 'output' }],
      providerId: 'silicon',
      model: 'new-model'
    })
  })
})
