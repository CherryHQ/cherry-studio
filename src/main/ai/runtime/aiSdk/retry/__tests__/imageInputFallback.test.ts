import type { LanguageModelV3Prompt } from '@ai-sdk/provider'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { downloadImageAsBase64, ocrImageBytes } = vi.hoisted(() => ({
  downloadImageAsBase64: vi.fn(),
  ocrImageBytes: vi.fn()
}))

vi.mock('@application', () => ({
  application: { get: () => ({ ocrImageBytes }) }
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ warn: vi.fn() }) }
}))

vi.mock('@main/utils/downloadAsBase64', () => ({ downloadImageAsBase64 }))

const { replaceImageInputsWithOcr } = await import('../imageInputFallback')

function promptWithImage(data: Uint8Array | string | URL = 'AQID'): LanguageModelV3Prompt {
  return [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'read this' },
        { type: 'file', data, mediaType: 'image/png', filename: 'screen.png' },
        { type: 'file', data: 'cGRm', mediaType: 'application/pdf', filename: 'doc.pdf' }
      ]
    }
  ]
}

describe('replaceImageInputsWithOcr', () => {
  beforeEach(() => vi.clearAllMocks())

  it('replaces image input with OCR text while preserving other content', async () => {
    ocrImageBytes.mockResolvedValue(' visible text ')

    const result = await replaceImageInputsWithOcr(promptWithImage())

    expect(result).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'read this' },
          { type: 'text', text: 'Attached image "screen.png":\nvisible text' },
          { type: 'file', data: 'cGRm', mediaType: 'application/pdf', filename: 'doc.pdf' }
        ]
      }
    ])
    expect(ocrImageBytes).toHaveBeenCalledOnce()
    expect(Array.from(ocrImageBytes.mock.calls[0][0])).toEqual([1, 2, 3])
    expect(ocrImageBytes).toHaveBeenCalledWith(expect.any(Uint8Array), 'image/png', undefined)
  })

  it('downloads URL image input before OCR and uses the detected media type', async () => {
    const signal = new AbortController().signal
    downloadImageAsBase64.mockResolvedValue({ data: 'AQID', media_type: 'image/webp' })
    ocrImageBytes.mockResolvedValue('visible text')

    const result = await replaceImageInputsWithOcr(promptWithImage(new URL('https://example.com/screen')), signal)

    expect(downloadImageAsBase64).toHaveBeenCalledWith('https://example.com/screen', signal)
    expect(ocrImageBytes).toHaveBeenCalledWith(expect.any(Uint8Array), 'image/webp', signal)
    expect(Array.from(ocrImageBytes.mock.calls[0][0])).toEqual([1, 2, 3])
    expect(result?.[0]).toMatchObject({
      role: 'user',
      content: expect.arrayContaining([{ type: 'text', text: 'Attached image "screen.png":\nvisible text' }])
    })
  })

  it('removes rejected image input when OCR finds no text', async () => {
    ocrImageBytes.mockResolvedValue('   ')

    const result = await replaceImageInputsWithOcr(promptWithImage(new Uint8Array([1])))

    expect(result?.[0]).toMatchObject({
      role: 'user',
      content: expect.arrayContaining([
        { type: 'text', text: '[Image omitted after the provider rejected image input.]' }
      ])
    })
  })

  it('removes rejected image input when OCR is unavailable', async () => {
    ocrImageBytes.mockRejectedValue(new Error('OCR is not configured'))

    const result = await replaceImageInputsWithOcr(promptWithImage(new Uint8Array([1])))

    expect(result?.[0]).toMatchObject({
      role: 'user',
      content: expect.arrayContaining([
        { type: 'text', text: '[Image omitted after the provider rejected image input.]' }
      ])
    })
  })

  it('returns null without touching OCR when the prompt has no image input', async () => {
    const result = await replaceImageInputsWithOcr([{ role: 'user', content: [{ type: 'text', text: 'hello' }] }])

    expect(result).toBeNull()
    expect(ocrImageBytes).not.toHaveBeenCalled()
  })
})
