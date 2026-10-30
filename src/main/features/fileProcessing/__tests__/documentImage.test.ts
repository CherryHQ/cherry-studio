import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { inspectDocumentImage, normalizeDocumentImage } from '../documentImage'
import { png } from './docxFixtures'

describe('embedded raster eligibility', () => {
  it('rejects a 127px smaller side but admits 128px, regardless of the long side', async () => {
    expect(await normalizeDocumentImage(await png(127, 1000))).toEqual({ kind: 'omitted', reason: 'too-small' })
    expect(await normalizeDocumentImage(await png(128, 1000))).toMatchObject({
      kind: 'image',
      width: 128,
      height: 1000
    })
  })
  it('fits 3136×1568 into 1568×784 without cropping and emits PNG even from JPEG', async () => {
    const jpeg = await sharp(await png(3136, 1568))
      .jpeg()
      .toBuffer()
    const result = await normalizeDocumentImage(jpeg)
    expect(result).toMatchObject({ kind: 'image', mediaType: 'image/png', width: 1568, height: 784 })
    if (result.kind === 'image')
      expect(await sharp(result.bytes).metadata()).toMatchObject({ format: 'png', width: 1568, height: 784 })
  })
  it('never upscales a small eligible raster', async () => {
    expect(await normalizeDocumentImage(await png(128, 256))).toMatchObject({ width: 128, height: 256 })
  })
  it('rejects source bytes beyond the expansion bound before decoding', async () => {
    expect(await normalizeDocumentImage(new Uint8Array(16_000_001))).toEqual({
      kind: 'omitted',
      reason: 'image-byte-limit'
    })
  })
  it('distinguishes unsupported vector data from a corrupt recognized PNG', async () => {
    expect(
      await normalizeDocumentImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"/>'))
    ).toEqual({ kind: 'omitted', reason: 'unsupported-image' })
    expect(await normalizeDocumentImage(Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'))).toEqual({
      kind: 'omitted',
      reason: 'unreadable-image'
    })
  })
  it('rejects an eligible raster whose normalized PNG would exceed four million bytes', async () => {
    const pixels = Buffer.alloc(1568 * 1568 * 3)
    let state = 123456789
    for (let index = 0; index < pixels.length; index++) {
      state ^= state << 13
      state ^= state >>> 17
      state ^= state << 5
      pixels[index] = state & 255
    }
    const bytes = await sharp(pixels, { raw: { width: 1568, height: 1568, channels: 3 } })
      .png()
      .toBuffer()
    expect(bytes.byteLength).toBeGreaterThan(4_000_000)
    expect(await normalizeDocumentImage(bytes)).toEqual({ kind: 'omitted', reason: 'image-byte-limit' })
  })
  it('deduplicates original bytes rather than normalized pixels', async () => {
    const first = await png()
    const a = await inspectDocumentImage(first)
    const b = await inspectDocumentImage(Buffer.from(first))
    const c = await inspectDocumentImage(await sharp(first).jpeg().toBuffer())
    expect(a.sha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(a.sha256).toBe(b.sha256)
    expect(a.sha256).not.toBe(c.sha256)
  })
})
