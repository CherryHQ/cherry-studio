import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { MockApplicationUtils } from '@test-mocks/main/application'
import sharp from 'sharp'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle'
import { HeifRenditionService } from '@main/services/HeifRenditionService'
import { assertQuadrants } from '@main/utils/__tests__/heifFixture'
import type { CherryUIMessage, FileUIPart } from '@shared/data/types/message'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import { IpcError } from '@shared/ipc/errors/IpcError'

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
import * as imageUtils from '@main/utils/image'

import { collectFileAttachments, prepareChatMessages } from '../attachmentRouting'
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

describe('HEIF history concurrency', () => {
  let service: HeifRenditionService
  let tmpDir: string
  let inputs: Buffer[]
  let png: { content: Buffer; mediaType: 'image/png'; width: number; height: number }

  beforeAll(async () => {
    png = {
      content: await sharp({ create: { width: 15, height: 15, channels: 3, background: '#ff0000' } })
        .png()
        .toBuffer(),
      mediaType: 'image/png',
      width: 15,
      height: 15
    }
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cherry-heif-history-'))
    const fixture = await fs.readFile('tests/fixtures/heif/quadrants.heic')
    // 26 exceeds eight waiting + one active + sixteen cached renditions, so cache growth cannot hide overload.
    inputs = Array.from({ length: 26 }, (_, i) => Buffer.concat([fixture, Buffer.from([i])]))
    await Promise.all(inputs.map((content, i) => fs.writeFile(path.join(tmpDir, `${i}.heic`), content)))
  })

  beforeEach(() => {
    BaseService.resetInstances()
    service = new HeifRenditionService()
    MockApplicationUtils.setService('HeifRenditionService', service)
    MockApplicationUtils.setService('FileManager', {
      getById: async () => ({ ext: '.heic' }),
      getVersion: async (id: string) => ({ size: inputs[Number(id)].length, mtime: 1 }),
      readChunk: async (id: string) => ({
        content: inputs[Number(id)],
        version: { size: inputs[Number(id)].length, mtime: 1 }
      })
    })
  })

  afterEach(async () => {
    await service._doStop()
    MockApplicationUtils.resetServices()
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  const history = (branch = 'data', count = inputs.length): CherryUIMessage[] =>
    inputs.slice(0, count).map((content, i) => ({
      id: `history-${i}`,
      role: 'user',
      parts: [
        { type: 'text', text: `photo ${i}` },
        filePart({
          filename: `${i}.heic`,
          mediaType: 'image/heic',
          url:
            branch === 'data'
              ? 'data:image/heic;base64,' + content.toString('base64')
              : `file://${path.join(tmpDir, `${i}.heic`)}`,
          ...(branch === 'entry' && { providerMetadata: { cherry: { fileEntryId: String(i) } } })
        })
      ]
    }))

  const prepare = (messages: CherryUIMessage[], signal?: AbortSignal) =>
    prepareChatMessages(messages, {
      attachments: collectFileAttachments(messages),
      nativeSupport: { image: true, pdf: false, audio: false, video: false },
      isToolCapable: false,
      signal
    })

  const expected = (messages: CherryUIMessage[]) =>
    messages.map((message, i) => ({
      ...message,
      parts: [
        message.parts[0],
        {
          ...message.parts[1],
          filename: `${i}.png`,
          mediaType: 'image/png',
          url: `data:image/png;base64,${png.content.toString('base64')}`
        }
      ]
    }))

  it.each(['entry', 'path', 'data'])(
    'prepares 26 distinct %s HEIF attachments in order within capacity',
    async (branch) => {
      let transcodes = 0,
        peakTranscodes = 0,
        consumers = 0,
        peakConsumers = 0
      vi.spyOn(imageUtils, 'transcodeHeifToPng').mockImplementation(async () => {
        peakTranscodes = Math.max(peakTranscodes, ++transcodes)
        await new Promise((resolve) => setTimeout(resolve, 5))
        transcodes--
        return png
      })
      const getRendition = service.getRendition.bind(service)
      vi.spyOn(service, 'getRendition').mockImplementation(async (...args) => {
        peakConsumers = Math.max(peakConsumers, ++consumers)
        try {
          return await getRendition(...args)
        } finally {
          consumers--
        }
      })
      const messages = history(branch)
      await expect(prepare(messages)).resolves.toEqual(expected(messages))
      expect(peakTranscodes).toBeGreaterThan(0)
      expect(peakTranscodes).toBeLessThanOrEqual(4)
      // The service serializes transcodes itself; admitted consumers expose whether chat work is actually bounded.
      expect(peakConsumers).toBeLessThanOrEqual(4)
    }
  )

  it('retries a transient busy attachment and prepares the turn', async () => {
    vi.spyOn(imageUtils, 'transcodeHeifToPng').mockResolvedValue(png)
    const attempts = vi.spyOn(service, 'getRendition').mockRejectedValueOnce(new IpcError(fileErrorCodes.HEIF_BUSY))
    const messages = history('data', 1)
    await expect(prepare(messages)).resolves.toEqual(expected(messages))
    expect(attempts.mock.calls.length).toBe(2)
  })

  it('rejects the turn with the busy detail after at most two retries', async () => {
    const attempts = vi.spyOn(service, 'getRendition').mockRejectedValue(new IpcError(fileErrorCodes.HEIF_BUSY))
    await expect(prepare(history('data', 1))).rejects.toMatchObject({
      name: 'HeifAttachmentError',
      detailI18nKey: 'heif_detail_busy'
    })
    expect(attempts.mock.calls.length).toBe(3)
  })

  it('releases active and queued work on abort even while a rendition remains pending', async () => {
    const controller = new AbortController()
    const reason = new DOMException('history cancelled', 'AbortError')
    const admitted: string[] = []
    let recoveryCount = 0
    let releaseRecovery!: () => void
    const recoveryGate = new Promise<void>((resolve) => {
      releaseRecovery = resolve
    })
    const getRendition = service.getRendition.bind(service)
    vi.spyOn(imageUtils, 'transcodeHeifToPng').mockResolvedValue(png)
    vi.spyOn(service, 'getRendition').mockImplementation(async (source, signal) => {
      if (signal === controller.signal) {
        admitted.push(source.kind)
        return new Promise(() => {})
      }
      recoveryCount++
      await recoveryGate
      return getRendition(source, signal)
    })
    const pending = prepare(history(), controller.signal).catch((error: unknown) => error)
    await vi.waitFor(() => expect(admitted.length).toBeGreaterThan(0))
    controller.abort(reason)
    const outcome = await Promise.race([
      pending,
      new Promise((resolve) => setTimeout(() => resolve('abort did not release HEIF work'), 100))
    ])
    expect(outcome).toBe(reason)
    const messages = history('data', 4)
    const recovery = prepare(messages)
    await vi.waitFor(() => expect(recoveryCount).toBe(4))
    releaseRecovery()
    await expect(recovery).resolves.toEqual(expected(messages))
    expect(admitted.length).toBeLessThanOrEqual(4)
  })

  it('cancels busy backoff with the original abort and does not retry cancelled work', async () => {
    const controller = new AbortController()
    const reason = new DOMException('cancel busy retry', 'AbortError')
    vi.spyOn(imageUtils, 'transcodeHeifToPng').mockResolvedValue(png)
    const attempts = vi.spyOn(service, 'getRendition').mockRejectedValueOnce(new IpcError(fileErrorCodes.HEIF_BUSY))
    const pending = prepare(history('data', 1), controller.signal)
    const rejected = expect(pending).rejects.toBe(reason)
    await vi.waitFor(() => expect(attempts.mock.calls.length).toBe(1), { interval: 1 })
    controller.abort(reason)
    await rejected
    const messages = history('data', 1)
    await expect(prepare(messages)).resolves.toEqual(expected(messages))
    expect(attempts.mock.calls.length).toBe(2)
  })
})
