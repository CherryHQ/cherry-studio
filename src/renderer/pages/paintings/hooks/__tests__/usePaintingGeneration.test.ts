import { mockUseMutation } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { popup } from '@renderer/services/popup'
import { type Model, MODEL_CAPABILITY } from '@shared/data/types/model'

import type { PaintingData } from '../../model/types/paintingData'
import { usePaintingGeneration } from '../usePaintingGeneration'

const mocks = vi.hoisted(() => ({
  createPainting: vi.fn(),
  updatePainting: vi.fn(),
  paintingGenerate: vi.fn(),
  models: [] as Model[]
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModels: () => ({ models: mocks.models, isLoading: false })
}))
vi.mock('../usePaintingProviderRuntime', () => ({
  usePaintingProviderRuntime: () => ({ provider: { id: 'openai', isEnabled: true }, isLoading: false })
}))
vi.mock('../../model/paintingPipeline', () => ({ paintingGenerate: mocks.paintingGenerate }))

const imageModel: Model = {
  apiModelId: 'gpt-image-1',
  capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION],
  id: 'openai::local-image',
  isEnabled: true,
  isHidden: false,
  name: 'GPT Image',
  providerId: 'openai',
  supportsStreaming: false
}

const painting: PaintingData = {
  id: 'painting-1',
  providerId: 'openai',
  mode: 'generate',
  model: 'gpt-image-1',
  prompt: 'a private prompt',
  files: [],
  params: { size: '1024x1024', quality: 'high', vendor_option: 'unknown' },
  persistedAt: '2026-01-01T00:00:00.000Z'
}

function presentedContext() {
  const call = vi.mocked(popup.error).mock.calls[0]?.[0] as { data?: { errorContext?: Record<string, unknown> } }
  return call?.data?.errorContext
}

async function runGenerate() {
  const { result } = renderHook(() => usePaintingGeneration({ painting, onPaintingChange: vi.fn() }))
  await act(async () => {
    await result.current.generate([], vi.fn())
  })
}

describe('usePaintingGeneration error details', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.models = [imageModel]
    mocks.updatePainting.mockResolvedValue({ createdAt: painting.persistedAt })
    mocks.createPainting.mockResolvedValue({ createdAt: painting.persistedAt })
    mockUseMutation.mockImplementation((method) => ({
      trigger:
        method === 'PATCH'
          ? (args?: { params?: { id?: string }; body?: unknown }) => mocks.updatePainting(args?.params?.id, args?.body)
          : mocks.createPainting,
      isLoading: false,
      error: undefined
    }))
  })

  // Doctor needs the local model id and image-only flag to diagnose an image model, not run a chat probe.
  it('files a generation failure with the image model, provider and non-content params', async () => {
    mocks.paintingGenerate.mockRejectedValueOnce(new Error('upstream 500'))

    await runGenerate()

    expect(presentedContext()).toEqual(
      expect.objectContaining({
        operation: 'painting.generate',
        providerId: 'openai',
        modelId: 'local-image',
        imageOnly: true,
        params: { size: '1024x1024', quality: 'high' }
      })
    )
  })

  // A local DB write failure is not a model fault; tagging the model sends Doctor after the wrong cause.
  it('files a record-save failure without the model', async () => {
    mocks.updatePainting.mockRejectedValueOnce(new Error('SQLITE_BUSY'))

    await runGenerate()

    const context = presentedContext()
    expect(context).toEqual(expect.objectContaining({ operation: 'painting.persist', providerId: 'openai' }))
    expect(context?.modelId).toBeUndefined()
    expect(context?.imageOnly).toBeUndefined()
    expect(mocks.paintingGenerate).not.toHaveBeenCalled()
  })
})
