import sharp from 'sharp'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ warn: vi.fn() }) } }))
const { files } = vi.hoisted(() => ({ files: new Map<string, Buffer>() }))
vi.mock('@application', () => ({
  application: {
    get: () => ({
      read: async (id: string) => ({ content: files.get(id)!.toString('base64'), mime: 'image/png' }),
      getById: async () => ({ ext: 'png' })
    })
  }
}))
vi.mock('@main/utils/file', () => ({
  read: async (path: string) => ({ data: files.get(path)!.toString('base64'), mime: 'image/png' })
}))
vi.mock('../attachmentTextExtraction', () => ({ extractDocumentText: vi.fn(), noExtractableTextNote: vi.fn() }))

import { prepareChatMessages } from '../attachmentRouting'
import { materializeNativeFilePart } from '../fileProcessor'

let valid: Buffer
let corrupt: Buffer
beforeAll(async () => {
  valid = await sharp({ create: { width: 120, height: 50, channels: 3, background: '#7f521e' } })
    .png()
    .toBuffer()
  corrupt = valid.subarray(0, Math.floor(valid.length / 2))
  files.set('/broken.png', corrupt)
  files.set('broken-entry', corrupt)
})
const context = {
  attachments: [],
  nativeSupport: { image: true, pdf: false, audio: false, video: false },
  isToolCapable: false
}

describe('normal chat corrupt image handling', () => {
  it.each(['file', 'entry', 'data'] as const)(
    'uses an explicit note for %s history and leaves stored content intact',
    async (kind) => {
      const part = {
        type: 'file' as const,
        filename: 'broken.png',
        mediaType: 'image/png',
        url: kind === 'data' ? `data:image/png;base64,${corrupt.toString('base64')}` : 'file:///broken.png',
        ...(kind === 'entry' ? { providerMetadata: { cherry: { fileEntryId: 'broken-entry' } } } : {})
      }
      const messages = [
        { id: 'old', role: 'user' as const, parts: [part] },
        { id: 'new', role: 'user' as const, parts: [{ type: 'text' as const, text: 'Next question without an image' }] }
      ]
      const stored = structuredClone(messages)
      const out = await prepareChatMessages(messages, context)
      expect(out[0].parts).toEqual([{ type: 'text', text: 'Attached file "broken.png": [could not read this file].' }])
      expect(out[1]).toEqual(messages[1])
      expect(messages).toEqual(stored)
      // The same input on the current turn receives the same explicit fallback.
      expect((await prepareChatMessages([messages[0]], context))[0].parts).toEqual(out[0].parts)
    }
  )

  it.each(['png', 'jpeg', 'webp', 'gif'] as const)('keeps valid %s byte-for-byte', async (format) => {
    const bytes = await sharp(valid).toFormat(format).toBuffer()
    const part = {
      type: 'file' as const,
      filename: `valid.${format}`,
      mediaType: `image/${format}`,
      url: `data:image/${format};base64,${bytes.toString('base64')}`
    }
    expect(await materializeNativeFilePart(part)).toEqual(part)
  })

  it('keeps valid percent-encoded image data unchanged', async () => {
    const url = 'data:image/png,' + [...valid].map((b) => '%' + b.toString(16).padStart(2, '0')).join('')
    const part = { type: 'file' as const, mediaType: 'image/png', url }
    expect(await materializeNativeFilePart(part)).toEqual(part)
  })

  it('accepts a valid JPEG with trailing padding', async () => {
    const bytes = Buffer.concat([await sharp(valid).jpeg().toBuffer(), Buffer.from([0, 0, 0])])
    const part = {
      type: 'file' as const,
      mediaType: 'image/jpeg',
      url: `data:image/jpeg;base64,${bytes.toString('base64')}`
    }
    expect(await materializeNativeFilePart(part)).toEqual(part)
  })

  it('documents strict-vs-tolerant decoding of a truncated PNG', async () => {
    await expect(sharp(corrupt, { failOn: 'none' }).stats()).resolves.toBeDefined()
    await expect(sharp(corrupt, { failOn: 'error' }).stats()).rejects.toThrow()
  })

  it('does not broaden validation to other formats or fetch remote images', async () => {
    for (const part of [
      { type: 'file' as const, mediaType: 'image/avif', url: 'data:image/avif;base64,AAA' },
      { type: 'file' as const, mediaType: 'image/png', url: 'https://example.com/image.png' }
    ])
      expect(await materializeNativeFilePart(part)).toEqual(part)
  })
})
