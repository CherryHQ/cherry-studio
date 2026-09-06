import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { cropPng, transcodeToEntityWebp } from '../image'

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
