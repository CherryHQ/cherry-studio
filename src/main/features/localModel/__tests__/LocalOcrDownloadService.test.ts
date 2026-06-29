import fs from 'node:fs'

import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

// Import the SUT after @application is mocked (its model dir resolves via application.getPath).
const { localOcrDownloadService } = await import('../LocalOcrDownloadService')

const DEFAULT_KEY = 'feature.file_processing.default_image_to_text'

describe('LocalOcrDownloadService.remove — default image-to-text demotion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockMainPreferenceServiceUtils.resetMocks()
    // cleanup() rm's the (mock) model dir — stub it so the test never touches the real fs.
    vi.spyOn(fs.promises, 'rm').mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
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
})
