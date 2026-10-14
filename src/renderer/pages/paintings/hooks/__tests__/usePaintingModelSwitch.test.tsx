import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { FileEntry } from '@shared/data/types/file'
import { MODALITY, MODEL_CAPABILITY, type Model } from '@shared/data/types/model'

import type { PaintingData } from '../../model/types/paintingData'
import type { ModelOption } from '../../model/types/paintingModel'

const mocks = vi.hoisted(() => ({
  models: [] as Model[]
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModels: () => ({ models: mocks.models })
}))

vi.mock('@data/hooks/useDataApi', () => ({
  prefetch: vi.fn(async () => null)
}))

vi.mock('../../errors/paintingGenerateError', () => ({
  presentPaintingGenerateError: vi.fn()
}))

const { usePaintingModelSwitch } = await import('../usePaintingModelSwitch')

const makeEntry = (id: string, ext = 'png'): FileEntry =>
  ({ id, name: `${id}.${ext}`, ext, size: 100, origin: 'internal' }) as unknown as FileEntry

const makeModel = (providerId: string, overrides: Partial<Model> = {}): Model => ({
  id: `${providerId}::gemini-image`,
  providerId,
  apiModelId: 'gemini-image',
  name: 'Gemini Image',
  capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION],
  inputModalities: [MODALITY.TEXT, MODALITY.IMAGE],
  outputModalities: [MODALITY.IMAGE],
  supportsStreaming: false,
  isEnabled: true,
  isHidden: false,
  ...overrides
})

const makeOption = (model: Model): ModelOption => ({
  label: model.name,
  value: model.apiModelId ?? 'gemini-image',
  raw: model
})

const editPainting = (overrides: Partial<PaintingData> = {}): PaintingData => ({
  id: 'p-1',
  providerId: 'provider-a',
  mode: 'edit',
  model: 'gemini-image',
  prompt: 'a cat',
  files: [],
  params: { size: '1024x1024' },
  inputFiles: [makeEntry('file-1')],
  ...overrides
})

const setup = (painting: PaintingData, catalog: ModelOption[] = [makeOption(makeModel('provider-b'))]) => {
  const onPaintingChange = vi.fn()
  const ensureProviderCatalog = vi.fn(async () => catalog)
  const { result } = renderHook(() => usePaintingModelSwitch({ painting, onPaintingChange, ensureProviderCatalog }))
  return { result, onPaintingChange, ensureProviderCatalog }
}

describe('usePaintingModelSwitch', () => {
  beforeEach(() => {
    mocks.models = [makeModel('provider-a')]
  })

  it('same-provider switch keeps the existing reset behaviour', async () => {
    mocks.models = [
      makeModel('provider-a'),
      makeModel('provider-a', { apiModelId: 'other-image', id: 'provider-a::other-image' })
    ]
    const painting = editPainting({ model: 'other-image' })
    const { result, onPaintingChange } = setup(painting)

    await act(async () => {
      await result.current({ providerId: 'provider-a', modelId: 'gemini-image' })
    })

    const patch = onPaintingChange.mock.calls[0]?.[0] as Partial<PaintingData> | undefined
    expect(patch).toMatchObject({ model: 'gemini-image', params: { size: '1024x1024' } })
    // The same-provider branch omits `inputFiles` when they can be kept —
    // merge semantics must preserve the attached files either way.
    expect(patch?.inputFiles ?? painting.inputFiles).toEqual(painting.inputFiles)
  })

  it('same model id under a different provider preserves the form context', async () => {
    const painting = editPainting()
    const { result, onPaintingChange } = setup(painting)

    await act(async () => {
      await result.current({ providerId: 'provider-b', modelId: 'gemini-image' })
    })

    expect(onPaintingChange).toHaveBeenCalledTimes(1)
    const patch = onPaintingChange.mock.calls[0]?.[0] as Partial<PaintingData> | undefined
    expect(patch).toMatchObject({
      providerId: 'provider-b',
      model: 'gemini-image',
      params: { size: '1024x1024' }
    })
    // Merge semantics: the patch must not touch mode or drop the attachments.
    expect(patch?.mode).toBeUndefined()
    expect(patch?.inputFiles ?? painting.inputFiles).toEqual(painting.inputFiles)
  })

  it('same model id under a different provider still drops input files when that provider model cannot edit', async () => {
    const painting = editPainting()
    const generateOnlyCatalog = [makeOption(makeModel('provider-b', { inputModalities: ['text'] }))]
    const { result, onPaintingChange } = setup(painting, generateOnlyCatalog)

    await act(async () => {
      await result.current({ providerId: 'provider-b', modelId: 'gemini-image' })
    })

    expect(onPaintingChange).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'provider-b',
        model: 'gemini-image',
        params: { size: '1024x1024' },
        inputFiles: []
      })
    )
  })

  it('a genuinely different model under a different provider still resets the form', async () => {
    const painting = editPainting()
    const { result, onPaintingChange } = setup(painting)

    await act(async () => {
      await result.current({ providerId: 'provider-b', modelId: 'flux-pro' })
    })

    expect(onPaintingChange).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'provider-b',
        model: 'flux-pro',
        mode: 'generate',
        params: {},
        inputFiles: []
      })
    )
  })
})
