import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { FileUIPart } from '@shared/data/types/message'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }
}))

const { readMock, fileManagerGetMetadataMock } = vi.hoisted(() => ({
  readMock: vi.fn<(id: string, options: { encoding: 'base64' }) => Promise<{ content: string; mime: string }>>(),
  fileManagerGetMetadataMock: vi.fn<(id: string) => Promise<{ size: number }>>()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const overrides = {
    FileManager: { read: readMock, getMetadata: fileManagerGetMetadataMock }
  } as Parameters<typeof mockApplicationFactory>[0]
  return mockApplicationFactory(overrides)
})

import { materializeNativeFilePart } from '../fileProcessor'

const filePart = (p: Partial<FileUIPart>): FileUIPart =>
  ({ type: 'file', url: '', mediaType: 'application/octet-stream', ...p }) as FileUIPart

describe('materializeNativeFilePart — file:// inline', () => {
  let tmpDir: string
  let imgPath: string

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cherry-fp-'))
    imgPath = path.join(tmpDir, 'pixel.png')
    const png = Buffer.from(
      '89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D4944415478DA636400' +
        '01000000050001A7DFAA680000000049454E44AE426082',
      'hex'
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

  it('leaves data: URLs untouched', async () => {
    const out = await materializeNativeFilePart(filePart({ url: 'data:image/png;base64,AAA', mediaType: 'image/png' }))
    expect(out?.url).toBe('data:image/png;base64,AAA')
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
    // The size pre-check uses `getMetadata` so the function refuses to allocate
    // a base64 buffer for a file that would blow the V8 heap on inflate. Wire
    // a size cap matching the actual mock payload (1 byte of 'A' → base64 'QUJD'),
    // otherwise the inner catch sets size = Infinity and the function returns
    // null before the assertion runs.
    readMock.mockReset()
    ;(fileManagerGetMetadataMock as ReturnType<typeof vi.fn>).mockReset()
    ;(fileManagerGetMetadataMock as ReturnType<typeof vi.fn>).mockResolvedValue({ size: 3 })
    readMock.mockResolvedValueOnce({ content: 'QUJD', mime: 'image/png' })
    const out = await materializeNativeFilePart(
      filePart({ mediaType: '.png', providerMetadata: { cherry: { fileEntryId: 'entry-1' } } })
    )
    expect(out?.mediaType).toBe('image/png')
    expect(out?.url).toBe('data:image/png;base64,QUJD')
    expect(readMock).toHaveBeenCalledWith('entry-1', { encoding: 'base64' })
  })

  it('drops the part when the entry is unreadable and there is no file:// rescue', async () => {
    readMock.mockReset()
    ;(fileManagerGetMetadataMock as ReturnType<typeof vi.fn>).mockReset()
    ;(fileManagerGetMetadataMock as ReturnType<typeof vi.fn>).mockResolvedValue({ size: 3 })
    readMock.mockRejectedValueOnce(new Error('entry not found'))
    const out = await materializeNativeFilePart(
      filePart({ url: '', providerMetadata: { cherry: { fileEntryId: 'gone' } } })
    )
    expect(out).toBeNull()
  })

  it('refuses to read a fileEntryId whose size exceeds the inline cap', async () => {
    readMock.mockReset()
    ;(fileManagerGetMetadataMock as ReturnType<typeof vi.fn>).mockReset()
    ;(fileManagerGetMetadataMock as ReturnType<typeof vi.fn>).mockResolvedValue({ size: 100 * 1_000_000 })
    readMock.mockResolvedValueOnce({ content: 'oversized', mime: 'image/png' })
    const out = await materializeNativeFilePart(
      filePart({ mediaType: 'image/png', providerMetadata: { cherry: { fileEntryId: 'entry-big' } } })
    )
    expect(out).toBeNull()
    expect(readMock).not.toHaveBeenCalled()
  })
})
