import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { FileEntry } from '@shared/data/types/file'
import type { ImageGenerationSupport } from '@shared/data/types/model'
import { MODALITY, MODEL_CAPABILITY, type Model } from '@shared/data/types/model'

import type { PaintingData } from '../../model/types/paintingData'
import type { ModelOption } from '../../model/types/paintingModel'
import { usePaintingModelSwitch } from '../usePaintingModelSwitch'

const prefetchMock = vi.fn<(path: string, options?: unknown) => Promise<ImageGenerationSupport | null>>()
vi.mock('@data/hooks/useDataApi', () => ({
  prefetch: (path: string, options?: unknown) => prefetchMock(path, options)
}))

const mockUseModels = vi.fn()
vi.mock('@renderer/hooks/useModel', () => ({
  useModels: (...args: unknown[]) => mockUseModels(...args)
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ error: vi.fn(), warn: vi.fn() }) }
}))

vi.mock('../../errors/paintingGenerateError', () => ({
  presentPaintingGenerateError: vi.fn()
}))

function makeModel(providerId: string, apiModelId: string, editCapable: boolean): Model {
  return {
    id: `${providerId}::${apiModelId}`,
    providerId,
    apiModelId,
    name: apiModelId,
    capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION],
    ...(editCapable ? { inputModalities: [MODALITY.IMAGE] } : {}),
    outputModalities: [MODALITY.IMAGE],
    supportsStreaming: false,
    isEnabled: true,
    isHidden: false
  } as Model
}

function makeOption(providerId: string, apiModelId: string, editCapable: boolean): ModelOption<Model> {
  return { label: apiModelId, value: apiModelId, raw: makeModel(providerId, apiModelId, editCapable) }
}

const inputFile = { id: 'input-1' } as unknown as FileEntry

function basePainting(overrides: Partial<PaintingData> = {}): PaintingData {
  return {
    id: 'p1',
    providerId: 'gemini',
    mode: 'edit',
    model: 'gemini-2.5-flash-image',
    prompt: 'a cat',
    files: [],
    inputFiles: [inputFile],
    params: { size: '1024x1024' },
    ...overrides
  }
}

const sizeSupport = (sizes: string[], fallbackDefault: string): ImageGenerationSupport => ({
  modes: {
    generate: { supports: { size: { type: 'enum', options: sizes, default: fallbackDefault } } },
    edit: { supports: { size: { type: 'enum', options: sizes, default: fallbackDefault } } }
  }
})

beforeEach(() => {
  prefetchMock.mockReset()
  mockUseModels.mockReset()
})

describe('usePaintingModelSwitch cross-provider same model', () => {
  it('preserves params, mode and inputFiles when moving the same model to another provider', async () => {
    const support = sizeSupport(['1024x1024', '2048x2048'], '1024x1024')
    prefetchMock.mockResolvedValue(support)
    mockUseModels.mockReturnValue({ models: [] })
    const targetCatalog = [makeOption('aggregator', 'gemini-2.5-flash-image', true)]

    const onPaintingChange = vi.fn()
    const { result } = renderHook(() =>
      usePaintingModelSwitch({
        painting: basePainting(),
        onPaintingChange,
        ensureProviderCatalog: async () => targetCatalog
      })
    )

    await result.current({ providerId: 'aggregator', modelId: 'gemini-2.5-flash-image' })

    expect(prefetchMock).toHaveBeenCalledTimes(2)
    // Cross-provider diff hits both providers' registry blocks.
    const requestedProviders = prefetchMock.mock.calls.map(
      (call) => (call[1] as { params: { providerId: string } }).params.providerId
    )
    expect(requestedProviders.sort()).toEqual(['aggregator', 'gemini'])
    expect(onPaintingChange).toHaveBeenCalledTimes(1)
    const patch = onPaintingChange.mock.calls[0][0] as Partial<PaintingData>
    expect(patch.providerId).toBe('aggregator')
    expect(patch.model).toBe('gemini-2.5-flash-image')
    expect(patch.params).toEqual({ size: '1024x1024' })
    // Mode + attachments survive: only provider/model/params/inputFiles are patched.
    expect(patch).not.toHaveProperty('mode')
    expect(patch).not.toHaveProperty('inputFiles')
  })

  it('clamps params the new provider rejects while keeping mode and inputFiles', async () => {
    prefetchMock.mockImplementation(async (_path: string, options?: unknown) => {
      const params = (options as { params: { providerId: string; modelId: string } }).params
      if (params.providerId === 'gemini') return sizeSupport(['1024x1024'], '1024x1024')
      return sizeSupport(['2048x2048'], '2048x2048')
    })
    mockUseModels.mockReturnValue({ models: [] })
    const targetCatalog = [makeOption('aggregator', 'gemini-2.5-flash-image', true)]

    const onPaintingChange = vi.fn()
    const { result } = renderHook(() =>
      usePaintingModelSwitch({
        painting: basePainting(),
        onPaintingChange,
        ensureProviderCatalog: async () => targetCatalog
      })
    )

    await result.current({ providerId: 'aggregator', modelId: 'gemini-2.5-flash-image' })

    const patch = onPaintingChange.mock.calls[0][0] as Partial<PaintingData>
    expect(patch.params).toEqual({ size: '2048x2048' })
    expect(patch).not.toHaveProperty('mode')
    expect(patch).not.toHaveProperty('inputFiles')
  })

  it('drops inputFiles when the target provider model cannot edit', async () => {
    prefetchMock.mockResolvedValue(sizeSupport(['1024x1024'], '1024x1024'))
    mockUseModels.mockReturnValue({ models: [] })
    const targetCatalog = [makeOption('aggregator', 'gemini-2.5-flash-image', false)]

    const onPaintingChange = vi.fn()
    const { result } = renderHook(() =>
      usePaintingModelSwitch({
        painting: basePainting(),
        onPaintingChange,
        ensureProviderCatalog: async () => targetCatalog
      })
    )

    await result.current({ providerId: 'aggregator', modelId: 'gemini-2.5-flash-image' })

    const patch = onPaintingChange.mock.calls[0][0] as Partial<PaintingData>
    expect(patch.inputFiles).toEqual([])
    expect(patch.params).toEqual({ size: '1024x1024' })
    expect(patch).not.toHaveProperty('mode')
  })

  it('still fully resets when the model actually differs across providers', async () => {
    mockUseModels.mockReturnValue({ models: [] })

    const onPaintingChange = vi.fn()
    const { result } = renderHook(() =>
      usePaintingModelSwitch({
        painting: basePainting(),
        onPaintingChange,
        ensureProviderCatalog: async () => [makeOption('aggregator', 'other-model', false)]
      })
    )

    await result.current({ providerId: 'aggregator', modelId: 'other-model' })

    const patch = onPaintingChange.mock.calls[0][0] as Partial<PaintingData>
    expect(patch.model).toBe('other-model')
    expect(patch.providerId).toBe('aggregator')
    expect(patch.mode).toBe('generate')
    expect(patch.params).toEqual({})
    expect(patch.inputFiles).toEqual([])
    expect(prefetchMock).not.toHaveBeenCalled()
  })
})
