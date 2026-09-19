import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ingestTranslateClipboardImage,
  shouldPreferTranslateClipboardImage,
  TRANSLATE_CLIPBOARD_IMAGE_EXTS
} from '../clipboardImagePaste'

const fileApi = vi.hoisted(() => ({
  getPathForFile: vi.fn(),
  createTempFile: vi.fn(),
  write: vi.fn(),
  get: vi.fn()
}))

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as any).api = {
    file: fileApi
  }
})

afterEach(() => {
  delete (window as any).api
})

describe('shouldPreferTranslateClipboardImage', () => {
  it('prefers a supported clipboard image even when a text flavor is also present', () => {
    expect(
      shouldPreferTranslateClipboardImage(
        [{ name: 'screenshot.png', type: 'image/png' }],
        TRANSLATE_CLIPBOARD_IMAGE_EXTS
      )
    ).toBe(true)
  })

  it('does not prefer unsupported image extensions', () => {
    expect(shouldPreferTranslateClipboardImage([{ name: 'photo.bmp', type: 'image/bmp' }], ['.png', '.jpg'])).toBe(
      false
    )
  })
})

describe('ingestTranslateClipboardImage', () => {
  it('returns metadata for a path-backed clipboard file', async () => {
    fileApi.getPathForFile.mockReturnValue('/tmp/shot.png')
    fileApi.get.mockResolvedValue({ path: '/tmp/shot.png', type: 'image', name: 'shot.png' })

    const file = { name: 'shot.png', type: 'image/png' } as File
    await expect(ingestTranslateClipboardImage(file)).resolves.toEqual({
      path: '/tmp/shot.png',
      type: 'image',
      name: 'shot.png'
    })
    expect(fileApi.createTempFile).not.toHaveBeenCalled()
  })

  it('writes pathless image bytes to a temp file before resolving metadata', async () => {
    fileApi.getPathForFile.mockReturnValue('')
    fileApi.createTempFile.mockResolvedValue('/tmp/pasted.png')
    fileApi.get.mockResolvedValue({ path: '/tmp/pasted.png', type: 'image', name: 'pasted.png' })

    const file = {
      name: 'pasted.png',
      type: 'image/png',
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(4))
    } as File

    await expect(ingestTranslateClipboardImage(file)).resolves.toEqual({
      path: '/tmp/pasted.png',
      type: 'image',
      name: 'pasted.png'
    })
    expect(fileApi.createTempFile).toHaveBeenCalledWith('pasted.png')
    expect(fileApi.write).toHaveBeenCalled()
  })

  it('rejects pathless non-image clipboard files', async () => {
    fileApi.getPathForFile.mockReturnValue('')
    const file = { name: 'notes.txt', type: 'text/plain' } as File
    await expect(ingestTranslateClipboardImage(file)).resolves.toBeNull()
    expect(fileApi.createTempFile).not.toHaveBeenCalled()
  })
})
