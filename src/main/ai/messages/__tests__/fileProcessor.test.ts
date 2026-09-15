import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

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

const png = Buffer.from(
  '89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D4944415478DA636400' +
    '01000000050001A7DFAA680000000049454E44AE426082',
  'hex'
)

describe('materializeNativeFilePart — file:// inline', () => {
  let tmpDir: string
  let imgPath: string

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cherry-fp-'))
    imgPath = path.join(tmpDir, 'pixel.png')
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

  it('rejects a data URL image declaration when its bytes are text', async () => {
    const out = await materializeNativeFilePart(filePart({ url: 'data:image/png;base64,QUJD', mediaType: 'image/png' }))
    expect(out?.mediaType).toBe('text/plain')
    expect(out?.url).toBe('data:text/plain;base64,QUJD')
  })

  it('recognizes percent-encoded binary data URL bytes', async () => {
    const encoded = Array.from(png, (byte) => `%${byte.toString(16).padStart(2, '0')}`).join('')
    const out = await materializeNativeFilePart(filePart({ url: `data:image/png,${encoded}`, filename: 'pixel.bin' }))

    expect(out?.mediaType).toBe('image/png')
    expect(out?.url).toBe(`data:image/png;base64,${png.toString('base64')}`)
  })

  it('does not promote text or ZIP bytes from a .png filename to native image', async () => {
    const textPath = path.join(tmpDir, 'text.png')
    const zipPath = path.join(tmpDir, 'archive.png')
    await fs.writeFile(textPath, 'plain text')
    await fs.writeFile(zipPath, Buffer.from('504b03041400000000000000000000000000000000000000000000', 'hex'))

    const text = await materializeNativeFilePart(filePart({ url: `file://${textPath}`, mediaType: 'image/png' }))
    const zip = await materializeNativeFilePart(filePart({ url: `file://${zipPath}`, mediaType: 'image/png' }))

    expect(text?.mediaType).toBe('text/plain')
    expect(zip?.mediaType).toBe('application/zip')
    expect(text?.url).toBe(`data:text/plain;base64,${Buffer.from('plain text').toString('base64')}`)
  })

  it.each(['pixel.bin', 'pixel'])("recognizes PNG bytes despite the filename '%s'", async (filename) => {
    const target = path.join(tmpDir, filename)
    await fs.writeFile(target, png)
    const out = await materializeNativeFilePart(filePart({ url: `file://${target}`, filename }))
    expect(out?.mediaType).toBe('image/png')
    expect(out?.url).toBe(`data:image/png;base64,${png.toString('base64')}`)
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
  it('reads via FileManager and uses content type over its extension-derived MIME', async () => {
    readMock.mockReset()
    readMock.mockResolvedValueOnce({ content: png.toString('base64'), mime: 'application/octet-stream' })
    const out = await materializeNativeFilePart(
      filePart({ mediaType: '.png', filename: 'pixel.bin', providerMetadata: { cherry: { fileEntryId: 'entry-1' } } })
    )
    expect(out?.mediaType).toBe('image/png')
    expect(out?.url).toBe(`data:image/png;base64,${png.toString('base64')}`)
    expect(readMock).toHaveBeenCalledWith('entry-1', { encoding: 'base64' })
  })

  it('rechecks the bytes at send time and recognizes a rescued file path after entry failure', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cherry-fp-fallback-'))
    const target = path.join(tmpDir, 'attachment.png')
    try {
      await fs.writeFile(target, png)
      readMock.mockReset().mockRejectedValue(new Error('entry gone'))
      const part = filePart({
        url: `file://${target}`,
        mediaType: 'image/png',
        providerMetadata: { cherry: { fileEntryId: 'gone' } }
      })
      const first = await materializeNativeFilePart(part)
      expect(first?.mediaType).toBe('image/png')

      await fs.writeFile(target, 'changed content')
      const changed = await materializeNativeFilePart(part)
      expect(changed?.mediaType).toBe('text/plain')
      expect(changed?.url).toBe(`data:text/plain;base64,${Buffer.from('changed content').toString('base64')}`)
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
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
