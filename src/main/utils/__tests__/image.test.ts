import UPNG from '@pdf-lib/upng'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { clampImageForModel, cropPng, ImageDecodeBudgetError, padApng, transcodeToEntityWebp } from '../image'

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
  it('normalizes arbitrary image bytes to WebP', async () => {
    const out = await transcodeToEntityWebp(new Uint8Array(PNG_1X1))
    const meta = await sharp(out).metadata()
    expect(meta.format).toBe('webp')
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

  it('returns null for an animated WebP whose frames already fit', async () => {
    const raw = Buffer.concat([
      Buffer.alloc(1000 * 1000 * 4, 80),
      Buffer.alloc(1000 * 1000 * 4, 160),
      Buffer.alloc(1000 * 1000 * 4, 240)
    ])
    const bytes = await sharp(raw, { raw: { width: 1000, height: 3000, channels: 4, pageHeight: 1000 } })
      .webp({ delay: [100, 100, 100] })
      .toBuffer()

    await expect(clampImageForModel(bytes)).resolves.toBeNull()
  })

  it('applies EXIF orientation before resizing a JPEG', async () => {
    const bytes = await sharp({ create: { width: 4000, height: 1000, channels: 3, background: '#ff0000' } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer()

    const out = await clampImageForModel(bytes)

    expect(await sharp(out!).metadata()).toMatchObject({ format: 'jpeg', width: 500, height: 2000 })
  })

  it('preserves APNG frames and delays while resizing', async () => {
    const width = 3000
    const height = 1000
    const frame = (red: number) => {
      const rgba = new Uint8Array(width * height * 4)
      for (let index = 0; index < rgba.length; index += 4) {
        rgba[index] = red
        rgba[index + 3] = 255
      }
      return rgba.buffer
    }
    const bytes = Buffer.from(UPNG.encode([frame(40), frame(200)], width, height, 0, [100, 200]))

    const out = await clampImageForModel(bytes)

    const decoded = UPNG.decode(out!.buffer.slice(out!.byteOffset, out!.byteOffset + out!.byteLength) as ArrayBuffer)
    expect(decoded.width).toBe(2000)
    expect(decoded.height).toBe(667)
    expect(decoded.frames.map((entry) => entry.delay)).toEqual([100, 200])
    expect(UPNG.toRGBA8(decoded)).toHaveLength(2)
  })

  it('throws on undecodable input', async () => {
    await expect(clampImageForModel(new Uint8Array([1, 2, 3]))).rejects.toThrow()
  })

  it('refuses an APNG whose aggregate frame expansion exceeds the decode budget', async () => {
    // A small file can declare a huge canvas and many frames: decoding would expand
    // width × height × frames RGBA buffers in memory (here 72M pixels ≈ 288 MB).
    // The budget must reject it from the header alone, before any decode work.
    const big = await sharp({ create: { width: 3000, height: 3000, channels: 3, background: '#ff0000' } })
      .png()
      .toBuffer()
    const bytes = injectActlChunk(big, 8)

    await expect(clampImageForModel(bytes)).rejects.toThrow(ImageDecodeBudgetError)
  })
})

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** Insert an animation control chunk after the IHDR, declaring the given frame count. */
function injectActlChunk(png: Buffer, frameCount: number): Buffer {
  const ihdrEnd = 8 + 4 + 4 + 13 + 4
  const actl = Buffer.alloc(4 + 4 + 8 + 4)
  actl.writeUInt32BE(8, 0)
  actl.write('acTL', 4, 'ascii')
  actl.writeUInt32BE(frameCount, 8)
  actl.writeUInt32BE(0, 12)
  actl.writeUInt32BE(crc32(actl.subarray(4, 16)), 16)
  return Buffer.concat([png.subarray(0, ihdrEnd), actl, png.subarray(ihdrEnd)])
}

describe('padApng', () => {
  const frame = (red: number, width: number, height: number) => {
    const rgba = new Uint8Array(width * height * 4)
    for (let index = 0; index < rgba.length; index += 4) {
      rgba[index] = red
      rgba[index + 3] = 255
    }
    return rgba.buffer
  }

  it('pads every frame to the target dimensions without dropping the animation', async () => {
    const width = 20
    const height = 4
    const bytes = Buffer.from(
      UPNG.encode([frame(40, width, height), frame(200, width, height)], width, height, 0, [100, 200])
    )

    const out = await padApng(bytes, width, height, 20, 15)

    const decoded = UPNG.decode(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer)
    expect(decoded.width).toBe(20)
    expect(decoded.height).toBe(15)
    expect(decoded.frames.map((entry) => entry.delay)).toEqual([100, 200])
    const rgba8 = UPNG.toRGBA8(decoded)
    expect(rgba8).toHaveLength(2)
    // First frame keeps its red level inside the centered content region (5 padding rows on top);
    // the padding rows themselves are white.
    const first = new Uint8Array(rgba8[0])
    expect(first[5 * 20 * 4]).toBe(40)
    expect([first[0], first[1], first[2], first[3]]).toEqual([255, 255, 255, 255])
    const paddingPixel = (15 - 1) * 20 * 4
    expect([first[paddingPixel], first[paddingPixel + 1], first[paddingPixel + 2], first[paddingPixel + 3]]).toEqual([
      255, 255, 255, 255
    ])
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
