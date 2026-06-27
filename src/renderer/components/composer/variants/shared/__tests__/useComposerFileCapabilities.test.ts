import type { Model } from '@shared/data/types/model'
import { audioExts, documentExts, imageExts, textExts, videoExts } from '@shared/utils/file/fileExtensions'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useComposerFileCapabilities } from '../useComposerFileCapabilities'

const mocks = vi.hoisted(() => ({
  isAudioModel: vi.fn(),
  isAudioModels: vi.fn(),
  isVideoModel: vi.fn(),
  isVideoModels: vi.fn()
}))

vi.mock('@renderer/utils/model', () => mocks)

const model = (id: string) => ({ id }) as unknown as Model
const containsAll = (haystack: string[], needles: string[]) => needles.every((n) => haystack.includes(n))
const ALL_EXTS = [...imageExts, ...audioExts, ...videoExts, ...documentExts, ...textExts]

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isAudioModel.mockReturnValue(false)
  mocks.isAudioModels.mockReturnValue(false)
  mocks.isVideoModel.mockReturnValue(false)
  mocks.isVideoModels.mockReturnValue(false)
})

describe('useComposerFileCapabilities', () => {
  describe('agent surface (bare model)', () => {
    it('disables attachments when no model is active', () => {
      const { result } = renderHook(() => useComposerFileCapabilities(undefined))

      expect(result.current.canAddImageFile).toBe(false)
      expect(result.current.canAddTextFile).toBe(false)
      expect(result.current.supportedExts).toEqual([])
    })

    it('allows every file type on any model — agent reads attachments by path, not by modality', () => {
      // No audio/video capability, yet every type is allowed: the agent forwards file paths
      // and reads them with its own tools, so the model's modality is irrelevant.
      const { result } = renderHook(() => useComposerFileCapabilities(model('m1')))

      expect(result.current.canAddImageFile).toBe(true)
      expect(result.current.canAddTextFile).toBe(true)
      expect(containsAll(result.current.supportedExts, ALL_EXTS)).toBe(true)
    })
  })

  describe('chat surface (mentioned models + fallback)', () => {
    it('allows images and documents on any model, even non-vision (OCR fallback)', () => {
      const { result } = renderHook(() => useComposerFileCapabilities({ models: [], fallbackModel: model('m1') }))

      expect(result.current.canAddImageFile).toBe(true)
      expect(result.current.canAddTextFile).toBe(true)
      expect(containsAll(result.current.supportedExts, imageExts)).toBe(true)
      expect(containsAll(result.current.supportedExts, documentExts)).toBe(true)
    })

    it('gates audio/video on the model capability (no fallback for them)', () => {
      const { result } = renderHook(() => useComposerFileCapabilities({ models: [], fallbackModel: model('m1') }))

      expect(containsAll(result.current.supportedExts, audioExts)).toBe(false)
      expect(containsAll(result.current.supportedExts, videoExts)).toBe(false)
    })

    it('adds audio exts only when every mentioned model supports audio input', () => {
      mocks.isAudioModels.mockReturnValue(true)
      const models = [model('a'), model('b')]

      const { result } = renderHook(() => useComposerFileCapabilities({ models, fallbackModel: undefined }))

      expect(mocks.isAudioModels).toHaveBeenCalledWith(models)
      expect(mocks.isAudioModel).not.toHaveBeenCalled()
      expect(containsAll(result.current.supportedExts, audioExts)).toBe(true)
      expect(containsAll(result.current.supportedExts, videoExts)).toBe(false)
    })

    it('falls back to the assistant model for audio when nothing is mentioned', () => {
      mocks.isAudioModel.mockReturnValue(true)
      const fallbackModel = model('assistant')

      const { result } = renderHook(() => useComposerFileCapabilities({ models: [], fallbackModel }))

      expect(mocks.isAudioModel).toHaveBeenCalledWith(fallbackModel)
      expect(containsAll(result.current.supportedExts, audioExts)).toBe(true)
    })
  })
})
