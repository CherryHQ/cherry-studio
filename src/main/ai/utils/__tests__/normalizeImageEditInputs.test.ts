import { readFileSync } from 'node:fs'

import { OpenAICompatibleImageModel } from '@ai-sdk/openai-compatible'
import { generateImage } from 'ai'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'

import { normalizeImageEditInputs } from '../normalizeImageEditInputs'

function dataUrl(bytes: Buffer, mediaType = 'image/jpeg'): string {
  return `data:${mediaType};base64,${bytes.toString('base64')}`
}

function decodeDataUrl(value: string): Buffer {
  return Buffer.from(value.slice(value.indexOf(',') + 1), 'base64')
}

function photo() {
  return sharp({ create: { width: 32, height: 24, channels: 3, background: '#c85020' } })
}

describe('normalizeImageEditInputs', () => {
  it('does not start reading an image when the request is already cancelled', async () => {
    const signal = AbortSignal.abort()
    const invalidJpeg = dataUrl(Buffer.from([0xff, 0xd8, 0xff, 0xe1]))
    await expect(normalizeImageEditInputs([invalidJpeg], signal)).rejects.toBe(signal.reason)
  })

  it.each([false, true])(
    'discards a cancelled conversion instead of returning or processing another image (next: %s)',
    async (hasNext) => {
      const controller = new AbortController()
      const reason = new DOMException('Cancelled', 'AbortError')
      const hdr = dataUrl(readFileSync(new URL('./fixtures/hdr.jpg', import.meta.url)))
      const encode = vi.spyOn(sharp.prototype, 'toBuffer').mockImplementationOnce(async () => {
        controller.abort(reason)
        return Buffer.alloc(0)
      })
      try {
        const images = hasNext ? [hdr, dataUrl(Buffer.from([0xff, 0xd8, 0xff, 0xe1]))] : [hdr]
        await expect(normalizeImageEditInputs(images, controller.signal)).rejects.toBe(reason)
      } finally {
        encode.mockRestore()
      }
    }
  )

  it('removes the HDR auxiliary image without resizing or replacing the SDR base with the gain map', async () => {
    const original = readFileSync(new URL('./fixtures/hdr.jpg', import.meta.url))
    expect((await sharp(original).metadata()).gainMap?.image.length).toBeGreaterThan(0)
    const inputs = [dataUrl(original)]
    const [result] = await normalizeImageEditInputs(inputs)
    const output = decodeDataUrl(result)
    const metadata = await sharp(output).metadata()

    expect(metadata).toMatchObject({ format: 'jpeg', width: 32, height: 24, space: 'srgb', channels: 3 })
    expect(metadata.gainMap).toBeUndefined()
    expect(metadata.xmp).toBeUndefined()
    expect(output.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]))
    const { data } = await sharp(output).raw().toBuffer({ resolveWithObject: true })
    const basePixels = await sharp(original).raw().toBuffer()
    for (const [channel, expected] of basePixels.subarray(0, 3).entries()) {
      expect(Math.abs(data[channel] - expected)).toBeLessThanOrEqual(5)
    }
    expect(inputs).toEqual([dataUrl(original)])
  })

  it('applies EXIF orientation before stripping metadata', async () => {
    const original = readFileSync(new URL('./fixtures/hdr-rotated.jpg', import.meta.url))
    expect(await sharp(original).metadata()).toMatchObject({ orientation: 6, gainMap: expect.any(Object) })
    const [result] = await normalizeImageEditInputs([dataUrl(original)])
    const metadata = await sharp(decodeDataUrl(result)).metadata()

    expect(metadata).toMatchObject({ width: 24, height: 32 })
    expect(metadata.orientation).toBeUndefined()
    expect(metadata.gainMap).toBeUndefined()
  })

  it('uses the actual JPEG bytes instead of trusting the declared MIME type', async () => {
    const original = readFileSync(new URL('./fixtures/hdr.jpg', import.meta.url))
    const [result] = await normalizeImageEditInputs([dataUrl(original, 'application/octet-stream')])

    expect(result.startsWith('data:image/jpeg;base64,')).toBe(true)
    expect((await sharp(decodeDataUrl(result)).metadata()).gainMap).toBeUndefined()
  })

  it('preserves ordinary JPEG, transparent PNG, and remote URLs byte-for-byte and in order', async () => {
    const jpeg = await photo().withMetadata({ orientation: 6 }).jpeg().toBuffer()
    const png = await sharp({
      create: { width: 8, height: 8, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.5 } }
    })
      .png()
      .toBuffer()
    const inputs = [dataUrl(jpeg), dataUrl(png, 'image/png'), 'https://example.com/photo.jpg']

    expect(await normalizeImageEditInputs(inputs)).toEqual(inputs)
    expect(await normalizeImageEditInputs([])).toEqual([])
  })

  it('rejects an unreadable JPEG before it can be submitted', async () => {
    await expect(normalizeImageEditInputs([dataUrl(Buffer.from([0xff, 0xd8, 0xff, 0xe1]))])).rejects.toThrow()
  })

  it('sends a single-image JPEG with the correct MIME while preserving the PNG mask', async () => {
    const hdr = readFileSync(new URL('./fixtures/hdr.jpg', import.meta.url))
    const mask = await photo().ensureAlpha(0).png().toBuffer()
    const requests: Request[] = []
    const model = new OpenAICompatibleImageModel('gpt-image-1', {
      provider: 'test',
      url: ({ path }) => `https://example.com/v1${path}`,
      headers: () => ({}),
      fetch: async (url, init) => {
        requests.push(new Request(url, init))
        return Response.json({ data: [{ b64_json: mask.toString('base64') }] })
      }
    })

    await generateImage({
      model,
      prompt: {
        text: 'Blur the background',
        images: await normalizeImageEditInputs([dataUrl(hdr)]),
        mask: dataUrl(mask, 'image/png')
      },
      maxRetries: 0
    })

    expect(requests).toHaveLength(1)
    expect(new URL(requests[0].url).pathname).toBe('/v1/images/edits')
    const form = await requests[0].formData()
    const uploaded = form.get('image') as File
    expect(uploaded.type).toBe('image/jpeg')
    const metadata = await sharp(Buffer.from(await uploaded.arrayBuffer())).metadata()
    expect(metadata).toMatchObject({ format: 'jpeg', width: 32, height: 24 })
    expect(metadata.gainMap).toBeUndefined()
    expect(Buffer.from(await (form.get('mask') as File).arrayBuffer())).toEqual(mask)
  })
})
