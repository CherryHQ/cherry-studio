import type { Model } from '@shared/data/types/model'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useComposerFileCapabilities } from '../useComposerFileCapabilities'

const mocks = vi.hoisted(() => ({
  isVisionModel: vi.fn(),
  isVisionModels: vi.fn(),
  isGenerateImageModel: vi.fn(),
  isGenerateImageModels: vi.fn()
}))

vi.mock('@renderer/config/models', () => mocks)

const model = (id: string) => ({ id }) as unknown as Model

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isVisionModel.mockReturnValue(false)
  mocks.isVisionModels.mockReturnValue(false)
  mocks.isGenerateImageModel.mockReturnValue(false)
  mocks.isGenerateImageModels.mockReturnValue(false)
})

describe('useComposerFileCapabilities', () => {
  it('allows text files only when nothing supports vision or image', () => {
    const { result } = renderHook(() => useComposerFileCapabilities(undefined))

    expect(result.current.canAddImageFile).toBe(false)
    expect(result.current.canAddTextFile).toBe(true)
  })

  it('agent single model: vision enables both image and text files', () => {
    mocks.isVisionModel.mockReturnValue(true)

    const { result } = renderHook(() => useComposerFileCapabilities(model('m1')))

    expect(result.current.canAddImageFile).toBe(true)
    expect(result.current.canAddTextFile).toBe(true)
  })

  it('agent single model: image-generation-only disallows text files', () => {
    mocks.isGenerateImageModel.mockReturnValue(true)

    const { result } = renderHook(() => useComposerFileCapabilities(model('m1')))

    expect(result.current.canAddImageFile).toBe(true)
    expect(result.current.canAddTextFile).toBe(false)
  })

  it('chat multi-model: uses the all-models predicate, not the single-model one', () => {
    mocks.isVisionModels.mockReturnValue(true)
    const models = [model('a'), model('b')]

    const { result } = renderHook(() => useComposerFileCapabilities({ models, fallbackModel: undefined }))

    expect(mocks.isVisionModels).toHaveBeenCalledWith(models)
    expect(mocks.isVisionModel).not.toHaveBeenCalled()
    expect(result.current.canAddImageFile).toBe(true)
  })

  it('chat: falls back to the assistant model when nothing is mentioned', () => {
    mocks.isVisionModel.mockReturnValue(true)
    const fallbackModel = model('assistant')

    const { result } = renderHook(() => useComposerFileCapabilities({ models: [], fallbackModel }))

    expect(mocks.isVisionModel).toHaveBeenCalledWith(fallbackModel)
    expect(result.current.canAddImageFile).toBe(true)
  })
})
