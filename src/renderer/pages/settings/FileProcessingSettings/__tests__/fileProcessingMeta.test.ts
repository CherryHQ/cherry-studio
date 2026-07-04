import type * as RendererConstantModule from '@renderer/utils/platform'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { shouldShowLanguageOptions, supportsLanguageConfig } from '../utils/fileProcessingMeta'

const platformMock = vi.hoisted(() => ({
  isWin: false
}))

vi.mock('@renderer/utils/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof RendererConstantModule>()

  return {
    ...actual,
    get isWin() {
      return platformMock.isWin
    }
  }
})

describe('fileProcessingMeta language options', () => {
  beforeEach(() => {
    platformMock.isWin = false
  })

  it('identifies processors that support language configuration', () => {
    expect(supportsLanguageConfig('system')).toBe(true)
    expect(supportsLanguageConfig('tesseract')).toBe(true)
    expect(supportsLanguageConfig('mistral')).toBe(false)
  })

  it('shows Tesseract language options on every platform', () => {
    expect(shouldShowLanguageOptions('tesseract')).toBe(true)
  })

  it('shows System OCR language options on Windows only', () => {
    platformMock.isWin = true
    expect(shouldShowLanguageOptions('system')).toBe(true)

    platformMock.isWin = false
    expect(shouldShowLanguageOptions('system')).toBe(false)
  })
})
