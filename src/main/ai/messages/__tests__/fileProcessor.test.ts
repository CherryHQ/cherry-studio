import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { FileUIPart } from '@shared/data/types/message'

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }
}))

const { readMock } = vi.hoisted(() => ({
  readMock: vi.fn<(id: string, options: { encoding: 'base64' }) => Promise<{ content: string; mime: string }>>()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const overrides = { FileManager: { read: readMock } } as Parameters<typeof mockApplicationFactory>[0]
  return mockApplicationFactory(overrides)
})

import { materializeNativeFilePart } from '../fileProcessor'

const filePart = (p: Partial<FileUIPart>): FileUIPart => ({
  type: 'file',
  url: '',
  mediaType: 'application/octet-stream',
  ...p
})

describe('materializeNativeFilePart — file:// inline', () => {
  let tmpDir: string
  let imgPath: string

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cherry-fp-'))
    imgPath = path.join(tmpDir, 'pixel.png')
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
      'base64'
    )
    await fs.writeFile(imgPath, png)
  })

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('rewrites a file:// URL to a base64 data URL', async () => {
    const out = await materializeNativeFilePart(
      filePart({ url: `file://${imgPath}`, mediaType: 'image/png', filename: 'pixel.png' })
    )
    expect(out?.url.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('normalizes a bare-extension mediaType (.png) from the on-disk file', async () => {
    const out = await materializeNativeFilePart(filePart({ url: `file://${imgPath}`, mediaType: '.png' }))
    expect(out?.mediaType).toBe('image/png')
    expect(out?.url.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('upgrades application/octet-stream from the on-disk file', async () => {
    const out = await materializeNativeFilePart(
      filePart({ url: `file://${imgPath}`, mediaType: 'application/octet-stream' })
    )
    expect(out?.mediaType).toBe('image/png')
  })

  it('rejects undecodable image data: URLs', async () => {
    const out = await materializeNativeFilePart(filePart({ url: 'data:image/png;base64,AAA', mediaType: 'image/png' }))
    expect(out).toBeNull()
  })

  it('leaves http(s) URLs untouched', async () => {
    const out = await materializeNativeFilePart(filePart({ url: 'https://example.com/a.png', mediaType: 'image/png' }))
    expect(out?.url).toBe('https://example.com/a.png')
  })

  it('sanitizes a bare-extension mediaType on a passthrough part (no disk read to overwrite)', async () => {
    // The http(s)/data: passthrough path skips fsRead/FileManager, so a stale `.png`
    // mediaType would survive and blow up the ai-sdk provider. The tail-end
    // sanitize is the only guard covering it.
    const out = await materializeNativeFilePart(
      filePart({ url: 'https://example.com/a.png', mediaType: '.png', filename: 'a.png' })
    )
    expect(out?.mediaType).toBe('image/png')
    expect(out?.url).toBe('https://example.com/a.png')
  })

  it('preserves the ai-sdk `image/*` placeholder on a passthrough part with no discoverable extension', async () => {
    // OpenAiMessageConverter / OpenAiResponsesMessageConverter / gatewayImageModel
    // emit `image/*` when the remote URL carries no mime hint. Sanitize must let
    // it through; downgrading to application/octet-stream would make the provider
    // stop treating the file as an image.
    const out = await materializeNativeFilePart(
      filePart({ url: 'https://example.com/generate?id=abc', mediaType: 'image/*' })
    )
    expect(out?.mediaType).toBe('image/*')
    expect(out?.url).toBe('https://example.com/generate?id=abc')
  })

  it('drops a file:// part that cannot be read', async () => {
    const out = await materializeNativeFilePart(
      filePart({ url: `file://${path.join(tmpDir, 'nope.png')}`, mediaType: 'image/png' })
    )
    expect(out).toBeNull()
  })

  it('does not call FileManager when there is no cherry meta', async () => {
    readMock.mockClear()
    await materializeNativeFilePart(filePart({ url: `file://${imgPath}`, mediaType: 'image/png' }))
    expect(readMock).not.toHaveBeenCalled()
  })
})

describe('materializeNativeFilePart — fileEntryId inline', () => {
  it('reads via FileManager and applies its MIME (overriding a bad hint)', async () => {
    readMock.mockReset()
    readMock.mockResolvedValueOnce({
      content: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
      mime: 'image/png'
    })
    const out = await materializeNativeFilePart(
      filePart({ mediaType: '.png', providerMetadata: { cherry: { fileEntryId: 'entry-1' } } })
    )
    expect(out?.mediaType).toBe('image/png')
    const output = Buffer.from(out!.url.split(',')[1], 'base64')
    expect(await sharp(output).metadata()).toMatchObject({ width: 15, height: 15 })
    const pixel = await sharp(output).extract({ left: 7, top: 7, width: 1, height: 1 }).raw().toBuffer()
    expect([...pixel]).toEqual([255, 0, 0])
    expect(readMock).toHaveBeenCalledWith('entry-1', { encoding: 'base64' })
  })

  it('drops the part when the entry is unreadable and there is no file:// rescue', async () => {
    readMock.mockReset()
    readMock.mockRejectedValueOnce(new Error('entry not found'))
    const out = await materializeNativeFilePart(
      filePart({ url: '', providerMetadata: { cherry: { fileEntryId: 'gone' } } })
    )
    expect(out).toBeNull()
  })
})

describe('attachment image padding', () => {
  const input = async (width: number, height: number) =>
    sharp({ create: { width, height, channels: 4, background: { r: 12, g: 34, b: 56, alpha: 0.5 } } })
      .png()
      .toBuffer()
  const partFor = (bytes: Buffer): FileUIPart =>
    filePart({
      url: `data:image/png;base64,${bytes.toString('base64')}`,
      mediaType: 'image/png',
      filename: 'strip.png'
    })

  it.each([
    [1000, 4, 1000, 15, 0, 5],
    [4, 1000, 15, 1000, 5, 0],
    [1, 1, 15, 15, 7, 7],
    [1000, 13, 1000, 15, 0, 1],
    [1000, 14, 1000, 15, 0, 0]
  ])('pads %i×%i without changing its pixels', async (width, height, outWidth, outHeight, left, top) => {
    const bytes = await input(width, height)
    const part = partFor(bytes)
    const snapshot = structuredClone(part)
    const result = await materializeNativeFilePart(part)
    const output = Buffer.from(result!.url.split(',')[1], 'base64')
    expect(await sharp(output).metadata()).toMatchObject({ width: outWidth, height: outHeight })
    expect(await sharp(output).extract({ left, top, width, height }).raw().toBuffer()).toEqual(
      await sharp(bytes).raw().toBuffer()
    )
    const border = await sharp(output)
      .extract({ left: outWidth - 1, top: outHeight - 1, width: 1, height: 1 })
      .raw()
      .toBuffer()
    expect([...border]).toEqual([255, 255, 255, 255])
    expect(part).toEqual(snapshot)
    expect(result?.filename).toBe('strip.png')
  })

  it.each([
    [1000, 15],
    [15, 1000],
    [15, 15]
  ])('retains compliant %i×%i encoded bytes', async (width, height) => {
    const part = partFor(await input(width, height))
    expect(await materializeNativeFilePart(part)).toEqual(part)
  })

  it('pads a percent-encoded image', async () => {
    const bytes = await input(4, 4)
    const part = partFor(bytes)
    part.url = `data:image/png,${[...bytes].map((byte) => `%${byte.toString(16).padStart(2, '0')}`).join('')}`
    const result = await materializeNativeFilePart(part)
    expect(await sharp(Buffer.from(result!.url.split(',')[1], 'base64')).metadata()).toMatchObject({
      width: 15,
      height: 15
    })
  })

  it('returns the original image if padding fails after decoding', async () => {
    const part = partFor(await input(4, 4))
    const extend = vi.spyOn(sharp.prototype, 'extend').mockImplementationOnce(() => {
      throw new Error('encoder failed')
    })
    try {
      expect(await materializeNativeFilePart(part)).toEqual(part)
    } finally {
      extend.mockRestore()
    }
  })

  it('retains the original when the planned animation exceeds the pixel budget', async () => {
    const part = partFor(await input(4, 4))
    const metadata = vi.spyOn(sharp.prototype, 'metadata').mockResolvedValueOnce({
      format: 'png',
      width: 4,
      height: 4,
      pageHeight: 4,
      pages: 500_000
    })
    try {
      expect(await materializeNativeFilePart(part)).toEqual(part)
    } finally {
      metadata.mockRestore()
    }
  })

  it('preserves both animation frames and their timing', async () => {
    const raw = Buffer.concat([Buffer.alloc(4 * 4 * 3, 40), Buffer.alloc(4 * 4 * 3, 200)])
    const bytes = await sharp(raw, { raw: { width: 4, height: 8, channels: 3, pageHeight: 4 } })
      .gif({ delay: [100, 200], loop: 3 })
      .toBuffer()
    const part = filePart({ url: `data:image/gif;base64,${bytes.toString('base64')}`, mediaType: 'image/gif' })
    const result = await materializeNativeFilePart(part)
    const output = Buffer.from(result!.url.split(',')[1], 'base64')
    const metadata = await sharp(output, { animated: true }).metadata()
    expect(metadata).toMatchObject({ width: 15, pageHeight: 15, pages: 2, delay: [100, 200], loop: 3 })
    const pixels = await sharp(output, { animated: true }).removeAlpha().raw().toBuffer()
    expect(pixels[(5 * 15 + 5) * 3]).toBe(40)
    expect(pixels[((15 + 5) * 15 + 5) * 3]).toBe(200)
  })

  it('normalizes managed, legacy, and rescued files without altering stored bytes', async () => {
    const bytes = await input(4, 4)
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cherry-pad-'))
    const filename = path.join(directory, 'strip.png')
    await fs.writeFile(filename, bytes)
    try {
      const metadata = { cherry: { fileEntryId: 'entry' } }
      readMock.mockResolvedValueOnce({ content: bytes.toString('base64'), mime: 'image/png' })
      const managed = await materializeNativeFilePart(filePart({ providerMetadata: metadata }))
      const legacy = await materializeNativeFilePart(filePart({ url: `file://${filename}` }))
      readMock.mockRejectedValueOnce(new Error('missing'))
      const rescued = await materializeNativeFilePart(
        filePart({ url: `file://${filename}`, providerMetadata: metadata })
      )
      expect(managed?.url).toBe(legacy?.url)
      expect(rescued?.url).toBe(legacy?.url)
      expect(rescued?.providerMetadata).toEqual(metadata)
      expect(await fs.readFile(filename)).toEqual(bytes)
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
})
