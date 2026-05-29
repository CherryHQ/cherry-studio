import type * as RendererConstantModule from '@renderer/config/constant'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const platformMock = vi.hoisted(() => ({
  isWin: false
}))

vi.mock('@renderer/config/constant', async (importOriginal) => {
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
    vi.resetModules()
  })

  it('identifies processors that support language configuration', async () => {
    const { supportsLanguageConfig } = await import('../utils/fileProcessingMeta')

    expect(supportsLanguageConfig('system')).toBe(true)
    expect(supportsLanguageConfig('tesseract')).toBe(true)
    expect(supportsLanguageConfig('mistral')).toBe(false)
  })

  it('shows Tesseract language options on every platform', async () => {
    const { shouldShowLanguageOptions } = await import('../utils/fileProcessingMeta')

    expect(shouldShowLanguageOptions('tesseract')).toBe(true)
  })

  it('shows System OCR language options on Windows only', async () => {
    platformMock.isWin = true
    const { shouldShowLanguageOptions } = await import('../utils/fileProcessingMeta')

    expect(shouldShowLanguageOptions('system')).toBe(true)

    vi.resetModules()
    platformMock.isWin = false
    const { shouldShowLanguageOptions: shouldShowLanguageOptionsOnNonWindows } = await import(
      '../utils/fileProcessingMeta'
    )

    expect(shouldShowLanguageOptionsOnNonWindows('system')).toBe(false)
  })
})
