import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { Model } from '@shared/data/types/model'
import { archiveExts, audioExts, documentExts, imageExts, textExts, videoExts } from '@shared/utils/file'

import { useComposerFileCapabilities } from '../useComposerFileCapabilities'

const model = (id: string) => ({ id }) as unknown as Model
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
    })

    it('allows common archive formats', () => {
      const { result } = renderHook(() => useComposerFileCapabilities(model('m1')))

      expect(containsAll(result.current.supportedExts, archiveExts)).toBe(true)
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

    it('allows audio and video on any model (transcription fallback)', () => {
      const { result } = renderHook(() => useComposerFileCapabilities({ models: [], fallbackModel: model('m1') }))

      expect(containsAll(result.current.supportedExts, audioExts)).toBe(true)
      expect(containsAll(result.current.supportedExts, videoExts)).toBe(true)
    })
  })
})
