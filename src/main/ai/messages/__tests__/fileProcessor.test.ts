import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { FileUIPart } from '@shared/data/types/message'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

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
    readMock.mockRejectedValueOnce(new Error('entry not found'))
    const out = await materializeNativeFilePart(
      filePart({ url: '', providerMetadata: { cherry: { fileEntryId: 'gone' } } })
    )
    expect(out).toBeNull()
  })
})
