import { readFileSync } from 'node:fs'

import type * as HeifBundle from 'libheif-js/libheif-wasm/libheif-bundle.mjs'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  clampImageForModel,
  cropPng,
  transcodeHeifToPng,
  transcodeToEntityWebp,
  validateHeifDimensions
} from '../image'

const { factoryOverride } = vi.hoisted(() => ({ factoryOverride: vi.fn() }))
vi.mock('libheif-js/libheif-wasm/libheif-bundle.mjs', async (importOriginal) => {
  const original = await importOriginal<typeof HeifBundle>()
  return { default: (options?: unknown) => factoryOverride(options) ?? original.default(options) }
})
afterEach(() => factoryOverride.mockReset())

/** A valid 1×1 PNG. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64'
)

/** A 40×20 PNG whose left half is red and right half is blue. */
async function makeTwoTonePng(): Promise<Buffer> {
  const left = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#ff0000' } })
    .png()
    .toBuffer()
  const right = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#0000ff' } })
    .png()
    .toBuffer()
  return sharp({ create: { width: 40, height: 20, channels: 3, background: '#000000' } })
    .composite([
      { input: left, left: 0, top: 0 },
      { input: right, left: 20, top: 0 }
    ])
    .png()
    .toBuffer()
}

describe('transcodeToEntityWebp', () => {
  it('normalizes arbitrary image bytes to a 128×128 WebP', async () => {
    const out = await transcodeToEntityWebp(new Uint8Array(PNG_1X1))
    const meta = await sharp(out).metadata()
    expect(meta.format).toBe('webp')
    expect(meta.width).toBe(128)
    expect(meta.height).toBe(128)
  })

  it('throws on undecodable input', async () => {
    await expect(transcodeToEntityWebp(new Uint8Array([1, 2, 3]))).rejects.toThrow()
  })
})

describe('clampImageForModel', () => {
  it('shrinks a tall image until its longest edge fits, keeping aspect ratio and format', async () => {
    // A full-page browser screenshot: narrow, and far taller than any provider's per-edge limit.
    const tall = await sharp({ create: { width: 100, height: 3000, channels: 3, background: '#ff0000' } })
      .png()
      .toBuffer()

    const out = await clampImageForModel(tall)

    expect(out).not.toBeNull()
    const meta = await sharp(out!).metadata()
    expect(meta.format).toBe('png')
    expect(meta.height).toBe(2000)
    expect(meta.width).toBe(67)
  })

  it('returns null for an image that already fits, so callers can skip re-encoding', async () => {
    await expect(clampImageForModel(new Uint8Array(PNG_1X1))).resolves.toBeNull()
  })

  it('throws on undecodable input', async () => {
    await expect(clampImageForModel(new Uint8Array([1, 2, 3]))).rejects.toThrow()
  })
})

describe('cropPng', () => {
  it('extracts exactly the requested region, at the requested offset', async () => {
    // Asserting the pixel colour, not just the size: an off-by-one or a swapped
    // left/top would still produce a 20×20 image, just of the wrong half.
    const cropped = await cropPng(await makeTwoTonePng(), { x: 20, y: 0, width: 20, height: 20 })

    const { data, info } = await sharp(cropped).raw().toBuffer({ resolveWithObject: true })
    expect([info.width, info.height]).toEqual([20, 20])
    expect([data[0], data[1], data[2]]).toEqual([0, 0, 255])
  })

  it('rejects a region reaching past the image instead of returning a smaller crop', async () => {
    // Pins the contract so nobody adds a silent clamp here: callers compute the
    // region from a scaled selection, and a clamp would hide their coordinate bug.
    await expect(cropPng(await makeTwoTonePng(), { x: 30, y: 0, width: 20, height: 20 })).rejects.toThrow()
  })
})

describe('HEIF primary rendition', () => {
  it('decodes real HEVC bytes to PNG without changing the source', async () => {
    const bytes = readFileSync('tests/fixtures/heif/quadrants.heic')
    const original = Buffer.from(bytes)
    const png = await transcodeHeifToPng(bytes)
    expect([png.width, png.height, png.mediaType]).toEqual([96, 64, 'image/png'])
    expect(Buffer.from(png.content).subarray(0, 4).toString('hex')).toBe('89504e47')
    const { data, info } = await sharp(png.content).raw().toBuffer({ resolveWithObject: true })
    expect([info.width, info.height, info.channels]).toEqual([96, 64, 4])
    for (const [x, y, color] of [
      [24, 16, [220, 30, 40]],
      [72, 16, [30, 160, 60]],
      [24, 48, [40, 60, 200]],
      [72, 48, [245, 245, 245]],
      [12, 12, [0, 0, 0]]
    ] as const) {
      for (const [channel, expected] of color.entries())
        expect(Math.abs(data[(y * info.width + x) * 4 + channel] - expected)).toBeLessThanOrEqual(12)
      expect(data[(y * info.width + x) * 4 + 3]).toBe(255)
    }
    expect(bytes).toEqual(original)
  })
  it.each(['quadrants-truncated.heic', 'not-heif.heic'])('rejects %s with a domain error', async (name) => {
    await expect(transcodeHeifToPng(readFileSync('tests/fixtures/heif/' + name))).rejects.toMatchObject({
      code: 'FILE_HEIF_INVALID'
    })
  })
  it.each([
    [0, 1, 'dimensions'],
    [16385, 1, 'dimensions'],
    [8000, 8000, 'pixels']
  ])('rejects invalid dimensions %s × %s before RGBA allocation', (width, height, limit) => {
    expect(() => validateHeifDimensions(Number(width), Number(height))).toThrow(
      expect.objectContaining({
        code: 'FILE_HEIF_TOO_LARGE',
        data: { limit }
      })
    )
  })
  it('propagates an already aborted signal', async () => {
    const signal = AbortSignal.abort(new Error('cancelled'))
    await expect(transcodeHeifToPng(new Uint8Array(), signal)).rejects.toThrow('cancelled')
  })
})

it('selects the primary handle, keeps transformed RGBA including alpha, and releases all allocations', async () => {
  const handle = {},
    image = {},
    context = {}
  const releaseImage = vi.fn(),
    releaseHandle = vi.fn(),
    freeContext = vi.fn()
  const decode = vi.fn(() => ({
    image,
    channels: [
      {
        id: 10,
        width: 1,
        height: 2,
        stride: 8,
        data: new Uint8Array([240, 20, 30, 128, 0, 0, 0, 0, 10, 40, 230, 255, 0, 0, 0, 0])
      }
    ]
  }))
  const fallback = vi.fn()
  factoryOverride.mockReturnValueOnce({
    heif_context_alloc: () => context,
    heif_context_read_from_memory: () => ({ code: { value: 0 } }),
    heif_context_get_primary_image_handle: () => handle,
    heif_context_get_list_of_top_level_image_IDs: fallback,
    heif_image_handle_get_width: () => 1,
    heif_image_handle_get_height: () => 2,
    heif_js_decode_image2: decode,
    heif_colorspace: { heif_colorspace_RGB: 1 },
    heif_chroma: { heif_chroma_interleaved_RGBA: 11 },
    heif_channel: { heif_channel_interleaved: 10 },
    heif_image_release: releaseImage,
    heif_image_handle_release: releaseHandle,
    heif_context_free: freeContext
  })
  const png = await transcodeHeifToPng(readFileSync('tests/fixtures/heif/quadrants.heic'))
  const rgba = await sharp(png.content).raw().toBuffer()
  expect([...rgba]).toEqual([240, 20, 30, 128, 10, 40, 230, 255])
  expect([png.width, png.height]).toEqual([1, 2])
  expect(fallback).not.toHaveBeenCalled()
  expect(decode).toHaveBeenCalledExactlyOnceWith(handle, 1, 11)
  expect(releaseImage).toHaveBeenCalledWith(image)
  expect(releaseHandle).toHaveBeenCalledWith(handle)
  expect(freeContext).toHaveBeenCalledWith(context)
})

it('reports decoder initialization failure without leaking its native diagnostic', async () => {
  factoryOverride.mockImplementationOnce(() => {
    throw new Error('/private/secret: native diagnostic')
  })
  await expect(transcodeHeifToPng(readFileSync('tests/fixtures/heif/quadrants.heic'))).rejects.toMatchObject({
    code: 'FILE_HEIF_UNAVAILABLE',
    message: 'FILE_HEIF_UNAVAILABLE'
  })
})
