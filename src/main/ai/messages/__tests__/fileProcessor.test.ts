import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { assertQuadrants } from '@main/utils/__tests__/heifFixture'
import type { FileUIPart } from '@shared/data/types/message'

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }
}))

const { readMock, getByIdMock, renditionMock } = vi.hoisted(() => ({
  getByIdMock: vi.fn().mockResolvedValue({ ext: '.png' }),
  renditionMock: vi.fn(),
  readMock: vi.fn<(id: string, options: { encoding: 'base64' }) => Promise<{ content: string; mime: string }>>()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const overrides = {
    FileManager: { read: readMock, getById: getByIdMock },
    HeifRenditionService: { getRendition: renditionMock }
  } as Parameters<typeof mockApplicationFactory>[0]
  return mockApplicationFactory(overrides)
})

import { transcodeHeifToPng } from '@main/utils/image'

import { materializeNativeFilePart } from '../fileProcessor'
import { HeifAttachmentError } from '../HeifAttachmentError'

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
    expect(out?.url).toBe(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC'
    )
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

describe('HEIF wire normalization', () => {
  const fixture = path.resolve('tests/fixtures/heif/quadrants.heic')
  it.each(['entry', 'path', 'data', 'data-percent'])(
    'emits PNG for the %s branch and preserves the original hash',
    async (branch) => {
      const bytes = await fs.readFile(fixture)
      const png = await transcodeHeifToPng(bytes)
      renditionMock.mockImplementationOnce(async (source) =>
        source.kind === 'bytes' ? transcodeHeifToPng(source.content) : png
      )
      if (branch === 'entry') getByIdMock.mockResolvedValueOnce({ ext: '.heic' })
      const input = filePart({
        filename: '目录/photo.HEIC',
        mediaType: 'image/heic',
        url:
          branch === 'data'
            ? 'data:image/heic;base64,' + bytes.toString('base64')
            : branch === 'data-percent'
              ? 'data:image/heic,' + [...bytes].map((b) => '%' + b.toString(16).padStart(2, '0')).join('')
              : 'file://' + fixture,
        ...(branch === 'entry' && { providerMetadata: { cherry: { fileEntryId: 'entry-1' } } })
      })
      const out = await materializeNativeFilePart(input)
      expect(out?.mediaType).toBe('image/png')
      expect(out?.filename).toBe('photo.png')
      expect(Buffer.from(out!.url.split(',')[1], 'base64').subarray(0, 4).toString('hex')).toBe('89504e47')
      await assertQuadrants(Buffer.from(out!.url.split(',')[1], 'base64'))
      expect(out?.providerMetadata).toEqual(input.providerMetadata)
      expect(
        createHash('sha256')
          .update(await fs.readFile(fixture))
          .digest('hex')
      ).toBe(createHash('sha256').update(bytes).digest('hex'))
      expect(input.mediaType).toBe('image/heic')
    }
  )
  it('does not rescue a failed canonical HEIF conversion from a stale PNG path', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: '.heic' })
    renditionMock.mockRejectedValueOnce(new Error('native diagnostic'))
    await expect(
      materializeNativeFilePart(
        filePart({
          mediaType: 'image/heic',
          url: 'file:///stale/photo.png',
          providerMetadata: { cherry: { fileEntryId: 'entry-1' } }
        })
      )
    ).rejects.toBeInstanceOf(HeifAttachmentError)
  })
})

it('rejects oversized inline HEIF before passing decoded bytes to the rendition service', async () => {
  renditionMock.mockClear()
  const payload = 'A'.repeat(Math.ceil(((64 * 1024 * 1024 + 1) * 4) / 3))
  await expect(
    materializeNativeFilePart(filePart({ mediaType: 'image/heic', url: 'data:image/heic;base64,' + payload }))
  ).rejects.toMatchObject({ name: 'HeifAttachmentError', detailI18nKey: 'heif_detail_too_large' })
  expect(renditionMock).not.toHaveBeenCalled()
})
