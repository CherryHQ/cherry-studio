import { describe, expect, it } from 'vitest'

import { resolveDefaultImageToTextProcessor } from '../defaultImageToTextProcessor'

describe('resolveDefaultImageToTextProcessor', () => {
  it('uses system OCR on macOS', () => {
    expect(resolveDefaultImageToTextProcessor('darwin')).toBe('system')
  })

  it('uses system OCR on Windows', () => {
    expect(resolveDefaultImageToTextProcessor('win32')).toBe('system')
  })

  it('uses tesseract OCR on Linux', () => {
    expect(resolveDefaultImageToTextProcessor('linux')).toBe('tesseract')
  })
})
