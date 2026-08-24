import { describe, expect, it, vi } from 'vitest'

async function importWithPlatform(platform: { isLinux: boolean; isMac: boolean; isWin: boolean }) {
  vi.resetModules()
  vi.doMock('@main/core/platform', () => ({
    isLinux: platform.isLinux,
    isMac: platform.isMac,
    isWin: platform.isWin
  }))

  const { resolveDefaultImageToTextProcessor } = await import('../defaultImageToTextProcessor')
  return resolveDefaultImageToTextProcessor
}

describe('resolveDefaultImageToTextProcessor', () => {
  it('uses system OCR on macOS', async () => {
    const resolve = await importWithPlatform({ isLinux: false, isMac: true, isWin: false })
    expect(resolve()).toBe('system')
  })

  it('uses system OCR on Windows', async () => {
    const resolve = await importWithPlatform({ isLinux: false, isMac: false, isWin: true })
    expect(resolve()).toBe('system')
  })

  it('uses tesseract OCR on Linux', async () => {
    const resolve = await importWithPlatform({ isLinux: true, isMac: false, isWin: false })
    expect(resolve()).toBe('tesseract')
  })
})
