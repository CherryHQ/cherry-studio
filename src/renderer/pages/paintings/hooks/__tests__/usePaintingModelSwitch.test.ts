import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PaintingData } from '../../model/types/paintingData'
import { usePaintingModelSwitch } from '../usePaintingModelSwitch'
import { usePaintingSession } from '../usePaintingSession'

const { resetFields } = vi.hoisted(() => ({ resetFields: vi.fn() }))
vi.mock('@renderer/hooks/useModel', () => ({ useModels: () => ({ models: [] }) }))
vi.mock('../../utils/loadModelFieldReset', () => ({ loadModelFieldReset: resetFields }))
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
    resetFields.mockReset().mockResolvedValue(() => ({}))
  })
  it.each(['openai', 'silicon'])('ignores a delayed %s model selection after navigating away', async (providerId) => {
    let release!: () => void
    const wait = new Promise<void>((resolve) => {
      release = resolve
    })
    resetFields.mockImplementationOnce(async () => {
      await wait
      return () => ({})
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
      result.current.session.edit({ prompt: 'Edited while switching' })
    })
    await act(async () => {
      release()
      await pending
    })
    expect(result.current.session.painting).toMatchObject({
      id: 'generated',
      prompt: 'Edited while switching',
      files: [{ id: 'output' }],
      providerId: 'silicon',
      model: 'new-model'
    })
  })

  it.each(['openai', 'silicon'])(
    'allows typing and attachment edits during a delayed %s switch',
    async (providerId) => {
      let release!: () => void
      const wait = new Promise<void>((resolve) => {
        release = resolve
      })
      resetFields.mockImplementationOnce(async () => {
        await wait
        return () => ({})
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
        pending = result.current.switchModel({ providerId, modelId: 'selected' })
      })
      act(() => {
        result.current.session.edit({ prompt: 'New prompt' })
        result.current.session.touch()
      })
      await act(async () => {
        release()
        await pending
      })
      expect(result.current.session.painting).toMatchObject({ providerId, model: 'selected', prompt: 'New prompt' })
    }
  )

  it('a newer model request wins even when the older request finishes last', async () => {
    let release!: () => void
    const wait = new Promise<void>((resolve) => {
      release = resolve
    })
    const { result } = renderHook(() => {
      const session = usePaintingSession(() => original)
      const switchModel = usePaintingModelSwitch({
        painting: session.painting,
        bindPaintingChange: session.bindEdit,
        ensureProviderCatalog: async (providerId) => {
          if (providerId === 'silicon') await wait
          return []
        }
      })
      return { session, switchModel }
    })
    let pending!: Promise<void>
    act(() => {
      pending = result.current.switchModel({ providerId: 'silicon', modelId: 'older' })
    })
    await act(async () => {
      await result.current.switchModel({ providerId: 'minimax', modelId: 'newer' })
    })
    await act(async () => {
      release()
      await pending
    })
    expect(result.current.session.painting).toMatchObject({ providerId: 'minimax', model: 'newer' })
  })

  it('computes the model reset using parameter edits made while constraints were loading', async () => {
    let release!: () => void
    const wait = new Promise<void>((resolve) => {
      release = resolve
    })
    resetFields.mockImplementationOnce(async () => {
      await wait
      return (values: Record<string, unknown>) => ({ quality: values.quality === 'high' ? 'high' : 'auto' })
    })
    const { result } = renderHook(() => {
      const session = usePaintingSession(() => original)
      const switchModel = usePaintingModelSwitch({
        painting: session.painting,
        bindPaintingChange: session.bindEdit,
        ensureProviderCatalog: async () => []
      })
      return { session, switchModel }
    })
    let pending!: Promise<void>
    act(() => {
      pending = result.current.switchModel({ providerId: 'openai', modelId: 'selected' })
    })
    act(() => {
      result.current.session.edit({ params: { quality: 'high', seed: '42' } })
    })
    await act(async () => {
      release()
      await pending
    })
    expect(result.current.session.painting).toMatchObject({
      model: 'selected',
      params: { quality: 'high', seed: '42' }
    })
  })

  it('a newer navigation invalidates model loading before that navigation finishes saving', async () => {
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
    let pending!: Promise<void>
    act(() => {
      pending = result.current.switchModel({ providerId: 'silicon', modelId: 'selected' })
    })
    const navigation = result.current.session.beginTransition()
    await act(async () => {
      release()
      await pending
    })
    expect(result.current.session.painting.model).toBe('old')
    expect(navigation.isCurrent()).toBe(true)
  })
})
