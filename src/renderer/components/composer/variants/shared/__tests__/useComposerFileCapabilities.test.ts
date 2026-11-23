import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { anyFileExt } from '@renderer/utils/file'
import { type Model, MODEL_CAPABILITY, type ModelCapability } from '@shared/data/types/model'
import { audioExts, documentExts, imageExts, textExts, videoExts } from '@shared/utils/file'

import { useComposerFileCapabilities } from '../useComposerFileCapabilities'

const model = (id: string, capabilities: ModelCapability[] = []) => ({ id, capabilities }) as unknown as Model
const containsAll = (haystack: string[], needles: readonly string[]) => needles.every((n) => haystack.includes(n))
const ALL_EXTS = [...imageExts, ...audioExts, ...videoExts, ...documentExts, ...textExts]

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
      // "Every file type" is the wildcard, not the modality catalogs: a format none
      // of them lists (`.onnx`, `.dwg`, `.h5`) must attach on the agent surface too.
      expect(result.current.supportedExts).toContain(anyFileExt)
    })
  })

  describe('chat surface (mentioned models + fallback)', () => {
    it('allows code / script / configuration text files on any model', () => {
      const { result } = renderHook(() => useComposerFileCapabilities({ models: [], fallbackModel: model('m1') }))

      expect(containsAll(result.current.supportedExts, ['.cs', '.css', '.sh', '.bash'])).toBe(true)
      expect(containsAll(result.current.supportedExts, ['.conf', '.config', '.yaml', '.toml', '.ini'])).toBe(true)
    })

    it('gates audio/video on the model capability (no fallback for them)', () => {
      const { result } = renderHook(() => useComposerFileCapabilities({ models: [], fallbackModel: model('m1') }))

      expect(containsAll(result.current.supportedExts, audioExts)).toBe(false)
      expect(containsAll(result.current.supportedExts, videoExts)).toBe(false)
    })

    it('adds audio exts only when every mentioned model supports audio input', () => {
      const audio = MODEL_CAPABILITY.AUDIO_RECOGNITION
      const models = [model('a', [audio]), model('b', [audio])]

      const { result } = renderHook(() => useComposerFileCapabilities({ models, fallbackModel: undefined }))

      expect(containsAll(result.current.supportedExts, audioExts)).toBe(true)
      expect(containsAll(result.current.supportedExts, videoExts)).toBe(false)

      const mixed = [model('a', [audio]), model('b')]
      const { result: mixedResult } = renderHook(() =>
        useComposerFileCapabilities({ models: mixed, fallbackModel: undefined })
      )

      expect(containsAll(mixedResult.current.supportedExts, audioExts)).toBe(false)
    })

    it('falls back to the assistant model for audio when nothing is mentioned', () => {
      const fallbackModel = model('assistant', [MODEL_CAPABILITY.AUDIO_RECOGNITION])

      const { result } = renderHook(() => useComposerFileCapabilities({ models: [], fallbackModel }))

      expect(containsAll(result.current.supportedExts, audioExts)).toBe(true)
    })
  })
})
