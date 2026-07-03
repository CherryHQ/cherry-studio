import fs from 'node:fs'

import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { terminate, terminateThen } = vi.hoisted(() => {
  const terminate = vi.fn()
  // terminateThen mirrors the real terminate-then-run-after ordering so the
  // invocationCallOrder assertions below (terminate before rm) still hold.
  const terminateThen = vi.fn(async (after: () => Promise<unknown>) => {
    await terminate()
    return after()
  })
  return { terminate, terminateThen }
})

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const result = mockApplicationFactory()
  const originalGet = result.application.get.getMockImplementation()!
  result.application.get.mockImplementation((name: string) => {
    if (name === 'OcrInferenceHost') return { terminate, terminateThen }
    return originalGet(name)
  })
  return result
})

// Import the SUT after @application is mocked (its model dir resolves via application.getPath).
const { localOcrDownloadService, dictTextFromInferenceYml } = await import('../LocalOcrDownloadService')

const DEFAULT_KEY = 'feature.file_processing.default_image_to_text'

describe('dictTextFromInferenceYml', () => {
  it('reproduces PaddleOCR dict format: leading blank slot, entries, trailing space slot', () => {
    const yml = ['PostProcess:', '  name: CTCLabelDecode', '  character_dict:', "  - '!'", '  - a', '  - 你'].join('\n')

    const text = dictTextFromInferenceYml(yml)

    expect(text).toBe('\n!\na\n你\n')
    // ppu-paddle-ocr parses the dict with split(/\r?\n/) and no trimming: index 0
    // must be the blank token and the final entry the space class.
    const entries = text.split(/\r?\n/)
    expect(entries[0]).toBe('')
    expect(entries.at(-1)).toBe('')
    expect(entries.slice(1, -1)).toEqual(['!', 'a', '你'])
  })

  it('throws when the yml has no PostProcess.character_dict', () => {
    expect(() => dictTextFromInferenceYml('PostProcess:\n  name: CTCLabelDecode\n')).toThrow('character_dict')
  })
})

describe('LocalOcrDownloadService.remove — default image-to-text demotion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockMainPreferenceServiceUtils.resetMocks()
    // cleanup() rm's the (mock) model dir — stub it so the test never touches the real fs.
    vi.spyOn(fs.promises, 'rm').mockResolvedValue(undefined)
  })

  it('clears the default when local-paddleocr is the current default (otherwise every OCR consumer throws)', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue(DEFAULT_KEY, 'local-paddleocr')

    const result = await localOcrDownloadService.remove()

    expect(result).toEqual({ removed: true })
    // null → resolveProcessorConfigByFeature falls back to the platform default instead of
    // pointing at a model whose weights we just deleted.
    expect(MockMainPreferenceServiceUtils.getPreferenceValue(DEFAULT_KEY)).toBeNull()
  })

  it('leaves a different default untouched', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue(DEFAULT_KEY, 'system')

    await localOcrDownloadService.remove()

    expect(MockMainPreferenceServiceUtils.getPreferenceValue(DEFAULT_KEY)).toBe('system')
  })

  it('deletes the model files regardless of the previous default', async () => {
    await localOcrDownloadService.remove()

    expect(vi.mocked(fs.promises.rm)).toHaveBeenCalledWith('/mock/feature.ocr.paddleocr', {
      recursive: true,
      force: true
    })
  })

  it('terminates the inference worker before deleting so open OCR handles are released', async () => {
    await localOcrDownloadService.remove()

    expect(terminate).toHaveBeenCalledTimes(1)
    // The worker (caching PaddleOcrService's native session + open weight files) must
    // be released BEFORE the weights are unlinked — Windows fails to delete open files.
    expect(terminate.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(fs.promises.rm).mock.invocationCallOrder[0])
  })
})
