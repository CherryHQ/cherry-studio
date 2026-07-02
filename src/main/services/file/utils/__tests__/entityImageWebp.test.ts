import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { transcodeToEntityWebp } from '../entityImageWebp'

/** A valid 1×1 PNG. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)

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
