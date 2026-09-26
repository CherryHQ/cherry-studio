import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MAX_TRANSLATE_IMAGE_BYTES } from '@shared/utils/constants'

import {
  ingestTranslateClipboardImage,
  shouldPreferTranslateClipboardImage,
  TRANSLATE_CLIPBOARD_IMAGE_EXTS
} from '../clipboardImagePaste'

const createObjectURLMock = vi.fn(() => 'blob:translate-preview')

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURLMock })
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
  const imageFile = (size: number, bytes = new Uint8Array(size), overrides?: Partial<File>) =>
    ({
      name: 'shot.png',
      type: 'image/png',
      size,
      arrayBuffer: () => Promise.resolve(bytes.buffer),
      ...overrides
    }) as File

  it('captures bytes and creates an object URL without filesystem IPC', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const file = imageFile(bytes.byteLength, bytes)

    await expect(ingestTranslateClipboardImage(file)).resolves.toEqual({
      name: 'shot.png',
      data: bytes,
      previewUrl: 'blob:translate-preview'
    })
    expect(createObjectURLMock).toHaveBeenCalledWith(file)
  })

  it('rejects non-image clipboard files before creating a preview', async () => {
    const file = imageFile(4, new Uint8Array(4), { name: 'notes.txt', type: 'text/plain' })
    await expect(ingestTranslateClipboardImage(file)).resolves.toBeNull()
    expect(createObjectURLMock).not.toHaveBeenCalled()
  })

  it.each([0, MAX_TRANSLATE_IMAGE_BYTES + 1])('rejects image size %s before reading bytes', async (size) => {
    const arrayBuffer = vi.fn(() => Promise.resolve(new ArrayBuffer(size)))

    await expect(ingestTranslateClipboardImage(imageFile(size, new Uint8Array(0), { arrayBuffer }))).resolves.toBeNull()
    expect(arrayBuffer).not.toHaveBeenCalled()
  })

  it('accepts an image at the exact size limit', async () => {
    const file = imageFile(MAX_TRANSLATE_IMAGE_BYTES)

    await expect(ingestTranslateClipboardImage(file)).resolves.toMatchObject({
      data: { byteLength: MAX_TRANSLATE_IMAGE_BYTES }
    })
    expect(createObjectURLMock).toHaveBeenCalledWith(file)
  })
})
