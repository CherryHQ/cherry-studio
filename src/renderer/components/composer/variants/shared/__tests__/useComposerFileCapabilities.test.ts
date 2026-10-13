import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { anyFileExt } from '@renderer/utils/file'
import { MODEL_CAPABILITY, type Model } from '@shared/data/types/model'
import { FILE_TYPE } from '@shared/types/file'
import {
  archiveExts,
  audioExts,
  documentExts,
  getFileTypeByExt,
  imageExts,
  textExts,
  videoExts
} from '@shared/utils/file'

import { useComposerFileCapabilities } from '../useComposerFileCapabilities'

const textModel = (id: string) => ({ id, capabilities: [] }) as unknown as Model
const capableModel = (id: string, capability: string) => ({ id, capabilities: [capability] }) as unknown as Model
const containsAll = (haystack: string[], needles: readonly string[]) => needles.every((n) => haystack.includes(n))
const ALL_EXTS = [...imageExts, ...audioExts, ...videoExts, ...documentExts, ...textExts]
const KNOWN_MEDIA_EXTS = [...audioExts, ...videoExts]

describe('useComposerFileCapabilities', () => {
  describe('agent surface (bare model)', () => {
    it('disables attachments when no model is active', () => {
      const { result } = renderHook(() => useComposerFileCapabilities(undefined))

      expect(result.current.canAddImageFile).toBe(false)
      expect(result.current.canAddTextFile).toBe(false)
      expect(result.current.supportedExts).toEqual([])
    })

    it('allows every file type on any model — agent reads attachments by path, not by modality', () => {
      const { result } = renderHook(() => useComposerFileCapabilities(textModel('m1')))

      expect(result.current.canAddImageFile).toBe(true)
      expect(result.current.canAddTextFile).toBe(true)
      expect(containsAll(result.current.supportedExts, ALL_EXTS)).toBe(true)
      expect(result.current.supportedExts).toContain('.webm')
      // "Every file type" is the wildcard, not the modality catalogs: a format none
      // of them lists (`.onnx`, `.dwg`, `.h5`) must attach on the agent surface too.
      expect(result.current.supportedExts).toContain(anyFileExt)
    })

    it('allows common archive formats', () => {
      const { result } = renderHook(() => useComposerFileCapabilities(textModel('m1')))

      expect(containsAll(result.current.supportedExts, archiveExts)).toBe(true)
    })
  })

  describe('chat surface (mentioned models + fallback)', () => {
    it('allows images and documents on any model, even non-vision (OCR fallback)', () => {
      const { result } = renderHook(() => useComposerFileCapabilities({ models: [], fallbackModel: textModel('m1') }))

      expect(result.current.canAddImageFile).toBe(true)
      expect(result.current.canAddTextFile).toBe(true)
      expect(containsAll(result.current.supportedExts, imageExts)).toBe(true)
      expect(containsAll(result.current.supportedExts, documentExts)).toBe(true)
    })

    it('allows code / script / configuration text files on any model', () => {
      const { result } = renderHook(() => useComposerFileCapabilities({ models: [], fallbackModel: textModel('m1') }))

      expect(containsAll(result.current.supportedExts, ['.cs', '.css', '.sh', '.bash'])).toBe(true)
      expect(containsAll(result.current.supportedExts, ['.conf', '.config', '.yaml', '.toml', '.ini'])).toBe(true)
    })

    it('accepts known audio, video, and WebM for a text-only model', () => {
      const { result } = renderHook(() =>
        useComposerFileCapabilities({ models: [], fallbackModel: textModel('text-only') })
      )

      expect(containsAll(result.current.supportedExts, KNOWN_MEDIA_EXTS)).toBe(true)
      expect(archiveExts.some((ext) => result.current.supportedExts.includes(ext))).toBe(false)
      expect(result.current.supportedExts).not.toContain(anyFileExt)
    })

    it('accepts known audio and video when mentioned models do not all support that input', () => {
      const models = [
        capableModel('audio', MODEL_CAPABILITY.AUDIO_RECOGNITION),
        textModel('text'),
        capableModel('video', MODEL_CAPABILITY.VIDEO_RECOGNITION)
      ]

      const { result } = renderHook(() => useComposerFileCapabilities({ models, fallbackModel: undefined }))

      expect(containsAll(result.current.supportedExts, KNOWN_MEDIA_EXTS)).toBe(true)
    })

    it('keeps WebM on the shared video extension owner and out of the audio list', () => {
      expect(videoExts).toContain('.webm')
      expect(audioExts).not.toContain('.webm')
      expect(getFileTypeByExt('.webm')).toBe(FILE_TYPE.VIDEO)
      expect(getFileTypeByExt('webm')).toBe(FILE_TYPE.VIDEO)
    })
  })
})
