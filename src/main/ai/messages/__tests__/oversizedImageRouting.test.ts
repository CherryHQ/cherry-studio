import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import sharp from 'sharp'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const { readMock } = vi.hoisted(() => ({ readMock: vi.fn() }))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    FileManager: { read: readMock, getById: async () => ({ ext: 'png' }) }
  })
})
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ warn: vi.fn(), error: vi.fn() }) } }))
vi.mock('../attachmentTextExtraction', () => ({ extractDocumentText: vi.fn(), noExtractableTextNote: vi.fn() }))

import { prepareChatMessages } from '../attachmentRouting'
import { materializeNativeFilePart } from '../fileProcessor'

let bytes: Buffer
beforeAll(async () => {
  bytes = await sharp({ create: { width: 4960, height: 6208, channels: 3, background: '#7f521e' } })
    .png()
    .toBuffer()
  readMock.mockImplementation(async () => ({ content: bytes.toString('base64'), mime: 'image/png' }))
})
const context = {
  attachments: [],
  nativeSupport: { image: true, pdf: false, audio: false, video: false },
  isToolCapable: false
}
const part = () => ({
  type: 'file' as const,
  filename: 'scan.png',
  mediaType: 'image/png',
  url: `data:image/png;base64,${bytes.toString('base64')}`
})
const dimensions = async (url: string) => {
  const metadata = await sharp(Buffer.from(url.split(',')[1], 'base64')).metadata()
  return [metadata.width, metadata.height]
}

describe('oversized image routing', () => {
  it('clamps an entry image that exceeds the patch limit', async () => {
    expect(Math.ceil(4960 / 32) * Math.ceil(6208 / 32)).toBe(30070)
    const original = { ...part(), providerMetadata: { cherry: { fileEntryId: 'entry' } } }
    const prepared = await prepareChatMessages([{ id: 'entry', role: 'user', parts: [original] }], context)
    const result = prepared[0].parts[0]
    expect(await dimensions(result.url)).toEqual([1598, 2000])
    expect(result).toMatchObject({
      filename: 'scan.png',
      mediaType: 'image/png',
      providerMetadata: original.providerMetadata
    })
    expect(Math.ceil(1598 / 32) * Math.ceil(2000 / 32)).toBe(3150)
  })
  it('clamps legacy inline history on every preparation without mutation', async () => {
    const messages = [
      { id: 'old', role: 'user' as const, parts: [part()] },
      { id: 'new', role: 'user' as const, parts: [{ type: 'text' as const, text: 'next' }] }
    ]
    const original = structuredClone(messages)
    const out = await prepareChatMessages(messages, context)
    const again = await prepareChatMessages(messages, context)
    expect(await dimensions((out[0].parts[0] as { url: string }).url)).toEqual([1598, 2000])
    expect(again).toEqual(out)
    expect(messages).toEqual(original)
    expect(out[1]).toEqual(messages[1])
  })
  it('clamps a legacy file URL rather than forwarding the oversized file', async () => {
    const dir = await mkdtemp(join(process.cwd(), '.image-routing-'))
    try {
      const path = join(dir, 'scan.png')
      await writeFile(path, bytes)
      const messages = [{ id: 'file', role: 'user' as const, parts: [{ ...part(), url: pathToFileURL(path).href }] }]
      const result = await prepareChatMessages(messages, context)
      expect(await dimensions((result[0].parts[0] as { url: string }).url)).toEqual([1598, 2000])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
  it('preserves the 2000 boundary and clamps the next pixel', async () => {
    for (const [width, height, expected] of [
      [2000, 2000, [2000, 2000]],
      [2001, 1000, [2000, 1000]]
    ] as const) {
      const image = await sharp({ create: { width, height, channels: 3, background: '#123456' } })
        .png()
        .toBuffer()
      const input = { ...part(), url: `data:image/png;base64,${image.toString('base64')}` }
      const output = await materializeNativeFilePart(input)
      expect(await dimensions(output!.url)).toEqual(expected)
      if (width === 2000) expect(output).toEqual(input)
    }
  })
  it.each(['jpeg', 'webp', 'gif'] as const)('clamps oversized %s without changing its format', async (format) => {
    const image = await sharp({ create: { width: 2001, height: 1000, channels: 3, background: '#123456' } })
      .toFormat(format)
      .toBuffer()
    const input = {
      ...part(),
      mediaType: `image/${format}`,
      url: `data:image/${format};base64,${image.toString('base64')}`
    }
    const output = await materializeNativeFilePart(input)
    const metadata = await sharp(Buffer.from(output!.url.split(',')[1], 'base64')).metadata()
    expect(metadata).toMatchObject({ width: 2000, height: 1000, format })
  })
  it('reports measured dimensions when encoding fails rather than dispatching the original', async () => {
    const failure = vi.spyOn(sharp.prototype, 'toBuffer').mockRejectedValueOnce(new Error('encoder failed'))
    try {
      const messages = [{ id: 'image', role: 'user' as const, parts: [part()] }]
      await expect(prepareChatMessages(messages, context)).rejects.toMatchObject({
        i18nKey: 'image_resize_failed',
        detailI18nKey: 'image_resize_failed_detail',
        detailI18nValues: { filename: 'scan.png', width: '4960', height: '6208', maxEdge: '2000' }
      })
    } finally {
      failure.mockRestore()
    }
  })
  it('blocks first-party resize failures and omits unsupported legacy images', async () => {
    const original = { ...part(), providerMetadata: { cherry: { fileEntryId: 'entry' } } }
    const message = { id: 'entry', role: 'user' as const, parts: [original] }
    const failure = vi.spyOn(sharp.prototype, 'toBuffer').mockRejectedValue(new Error('encoder failed'))
    try {
      await expect(prepareChatMessages([message], context)).rejects.toMatchObject({
        detailI18nValues: { filename: 'scan.png', width: '4960', height: '6208', maxEdge: '2000' }
      })
      const [omitted] = await prepareChatMessages([{ ...message, parts: [part()] }], {
        ...context,
        nativeSupport: { ...context.nativeSupport, image: false }
      })
      expect(omitted.parts).toEqual([
        { type: 'text', text: '[image attachment omitted: this model does not accept image input]' }
      ])
    } finally {
      failure.mockRestore()
    }
  })
  it('does not launder an oversized truncated image through resizing', async () => {
    const corrupt = bytes.subarray(0, Math.floor(bytes.length / 2))
    const input = { ...part(), url: `data:image/png;base64,${corrupt.toString('base64')}` }
    expect(await materializeNativeFilePart(input)).toBeNull()
  })
  it('preserves cancellation when the resize fails', async () => {
    const controller = new AbortController()
    const abort = new DOMException('cancelled', 'AbortError')
    controller.abort(abort)
    const failure = vi.spyOn(sharp.prototype, 'toBuffer').mockRejectedValueOnce(new Error('encoder failed'))
    try {
      await expect(
        prepareChatMessages([{ id: 'image', role: 'user', parts: [part()] }], { ...context, signal: controller.signal })
      ).rejects.toBe(abort)
    } finally {
      failure.mockRestore()
    }
  })
})
