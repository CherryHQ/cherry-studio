import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { convertToModelMessages, type UIMessage } from 'ai'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { readFile } from '@main/ai/tools/adapters/aiSdk/builtin/ReadFileTool'
import { READ_FILE_PAGE_SIZE } from '@shared/ai/builtinTools'
import type { FileUIPart } from '@shared/data/types/message'

const { readMock, getByIdMock, ocrMock } = vi.hoisted(() => ({
  readMock: vi.fn(),
  getByIdMock: vi.fn(),
  ocrMock: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const overrides = { FileManager: { read: readMock, getById: getByIdMock } } as Parameters<
    typeof mockApplicationFactory
  >[0]
  const result = mockApplicationFactory(overrides)
  const get = result.application.get
  result.application.get = vi.fn((name: string) =>
    name === 'FileProcessingService' ? { ocrImage: ocrMock } : get(name)
  )
  return result
})

import { collectFileAttachments, prepareChatMessages } from '../attachmentRouting'

const png = Buffer.from(
  '89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D4944415478DA636400' +
    '01000000050001A7DFAA680000000049454E44AE426082',
  'hex'
)

const docx = Buffer.from(
  'UEsDBAoAAAAIAK9OLl2sbhJangAAANwAAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbF2PsQ7CMBBDf6XKitqrGBhQ24UdGPiBU3JtI5pLlBwF/p4EpA6Mlu1nubu9A6Xq5RZOvZpFwhEg6ZkcpsYH4uyMPjqULOMEAfUdJ4J92x5AexZiqaUw1NBdVorRGqquGOWMjnoFTx8NGK8fLiebTFPV6Vcry73CEBarUaxnWNn8bdZ+HK2mrV9oIXpNKVme3NJsjkPLu4KHoYPvqeEDUEsDBAoAAAAAAK9OLl0AAAAAAAAAAAAAAAAFAAAAd29yZC9QSwMECgAAAAgAr04uXZwma2R3AAAAnQAAABEAAAB3b3JkL2RvY3VtZW50LnhtbEXOzQ3CMAwF4FWqDoArDhyikBWYIeSnjVTHkR0U2J66HLh8lt+TJdthIoUXptqnN+5VzLjPW+/NAEjYEnq5UEv16DIx+n6svMIgjo0pJJFSV9zhuiw3QF/q7OwwT4ofnU1hpbtHziWkSSsLGqh82k5/R/B/yH0BUEsBAhQACgAAAAgAr04uXaxuElqeAAAA3AAAABMAAAAAAAAAAAAAAAAAAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAAKAAAAAACvTi5dAAAAAAAAAAAAAAAABQAAAAAAAAAAABAAAADPAAAAd29yZC9QSwECFAAKAAAACACvTi5dnCZrZHcAAACdAAAAEQAAAAAAAAAAAAAAAADyAAAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAMAAwCzAAAAmAEAAAAA',
  'base64'
)

const part = (filename: string, url: string, fileEntryId?: string): FileUIPart => ({
  type: 'file',
  filename,
  url,
  mediaType: 'image/png',
  ...(fileEntryId ? { providerMetadata: { cherry: { fileEntryId } } } : {})
})

async function sdkContent(file: FileUIPart, image = true, pdf = true) {
  const messages = [{ id: 'user-1', role: 'user', parts: [file] }] as UIMessage[]
  const prepared = await prepareChatMessages(messages, {
    attachments: collectFileAttachments(messages),
    nativeSupport: { image, pdf, audio: true, video: true },
    isToolCapable: false
  })
  const sdk = await convertToModelMessages(prepared)
  return sdk[0].content
}

describe('chat attachment content admission into AI SDK', () => {
  let tmpDir: string

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cherry-attachment-content-'))
  })

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  beforeEach(() => {
    readMock.mockReset()
    getByIdMock.mockReset()
    ocrMock.mockReset()
  })

  it('sends text disguised as PNG as text, not a native image', async () => {
    const target = path.join(tmpDir, 'fake.png')
    await fs.writeFile(target, 'hello from text')

    const content = await sdkContent(part('fake.png', pathToFileURL(target).href))

    expect(content).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('hello from text') })
    ])
  })

  it('sends PNG bytes with a .bin name as an image', async () => {
    const target = path.join(tmpDir, 'pixel.bin')
    await fs.writeFile(target, png)

    const content = await sdkContent(part('pixel.bin', pathToFileURL(target).href))

    expect(content).toEqual([
      expect.objectContaining({
        type: 'file',
        mediaType: 'image/png',
        data: `data:image/png;base64,${png.toString('base64')}`
      })
    ])
  })

  it('OCRs a recognized PNG with a .bin name for a non-vision model', async () => {
    readMock.mockResolvedValueOnce({ content: png.toString('base64'), mime: 'application/octet-stream' })
    getByIdMock.mockResolvedValueOnce({ ext: 'bin' })
    ocrMock.mockResolvedValueOnce('recognized image text')

    const content = await sdkContent(part('pixel.bin', 'file:///stale/pixel.bin', 'entry-pixel'), false)

    expect(content).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('recognized image text') })
    ])
  })

  it('does not trust a data URL that claims PNG but contains text', async () => {
    const content = await sdkContent(part('payload.png', 'data:image/png;base64,QUJD'))

    expect(content).toEqual([expect.objectContaining({ type: 'text', text: expect.stringContaining('ABC') })])
  })

  it('decodes BOM-marked UTF-16 text instead of treating its bytes as media', async () => {
    const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('hello 中文', 'utf16le')])
    const content = await sdkContent(part('encoded.png', `data:image/png;base64,${bytes.toString('base64')}`), false)

    expect(content).toEqual([expect.objectContaining({ type: 'text', text: expect.stringContaining('hello 中文') })])
  })

  it('uses the bytes present at send time after a local attachment changes', async () => {
    const target = path.join(tmpDir, 'changed.png')
    await fs.writeFile(target, png)
    const file = part('changed.png', pathToFileURL(target).href)
    expect(await sdkContent(file)).toEqual([expect.objectContaining({ type: 'file', mediaType: 'image/png' })])

    await fs.writeFile(target, 'replacement text')
    expect(await sdkContent(file)).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('replacement text') })
    ])
  })

  it('keeps PDF native and SVG as readable text despite misleading declarations', async () => {
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF')
    const pdfContent = await sdkContent(part('document.bin', `data:image/png;base64,${pdf.toString('base64')}`))
    const svgContent = await sdkContent(
      part('diagram.png', 'data:image/png,%3Csvg%20viewBox=%220%200%201%201%22%3E%3C/svg%3E')
    )

    expect(pdfContent).toEqual([
      expect.objectContaining({
        type: 'file',
        mediaType: 'application/pdf',
        data: `data:application/pdf;base64,${pdf.toString('base64')}`
      })
    ])
    expect(svgContent).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('<svg viewBox="0 0 1 1"></svg>') })
    ])
  })

  it('keeps a legacy SVG as text when vision is unavailable', async () => {
    const content = await sdkContent(
      part('diagram.png', 'data:image/png,%3Csvg%20viewBox=%220%200%201%201%22%3E%3C/svg%3E'),
      false
    )

    expect(content).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('<svg viewBox="0 0 1 1"></svg>') })
    ])
  })

  it('does not send recognized legacy PDF to a provider without native PDF support', async () => {
    const document = await PDFDocument.create()
    const page = document.addPage()
    page.drawText('PDF_CONTENT_SENTINEL', { x: 50, y: 700, font: await document.embedFont(StandardFonts.Helvetica) })
    const pdf = Buffer.from(await document.save())
    const content = await sdkContent(part('report.bin', `data:image/png;base64,${pdf.toString('base64')}`), true, false)

    expect(content).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('PDF_CONTENT_SENTINEL') })
    ])
  })

  it('extracts an Office document recognized under a .bin filename', async () => {
    vi.mocked(application.getPath).mockReturnValue(tmpDir)
    readMock.mockResolvedValueOnce({ content: docx.toString('base64'), mime: 'application/octet-stream' })
    getByIdMock.mockResolvedValueOnce({ ext: 'bin' })

    const content = await sdkContent(part('notes.bin', 'file:///stale/notes.bin', 'entry-docx'))

    expect(content).toEqual([expect.objectContaining({ type: 'text', text: expect.stringContaining('Office body') })])
  })

  it('pages the same recognized text for a misnamed managed attachment', async () => {
    const body = `${'a'.repeat(10_000)}TAIL_SENTINEL`
    readMock.mockResolvedValue({ content: Buffer.from(body).toString('base64'), mime: 'image/png' })
    getByIdMock.mockResolvedValue({ ext: 'png' })

    const file = part('misnamed.png', 'file:///stale/misnamed.png', 'entry-text')
    const messages = [{ id: 'user-1', role: 'user', parts: [file] }] as UIMessage[]
    const attachments = collectFileAttachments(messages)
    const prepared = await prepareChatMessages(messages, {
      attachments,
      nativeSupport: { image: false, pdf: false, audio: false, video: false },
      isToolCapable: true
    })
    const inline = (prepared[0].parts[0] as { text: string }).text
    const offset = Number(inline.match(/read_file\("misnamed\.png", offset=(\d+)\)/)?.[1])
    expect(offset).toBeGreaterThan(0)

    const tail = await readFile({ filename: 'misnamed.png', offset }, { attachments })
    expect(tail).toMatchObject({ text: expect.stringContaining('TAIL_SENTINEL'), totalChars: body.length })
    expect(ocrMock).not.toHaveBeenCalled()
  })

  it('pages recognized Office content even when the managed extension is .bin', async () => {
    vi.mocked(application.getPath).mockReturnValue(tmpDir)
    readMock.mockResolvedValue({ content: docx.toString('base64'), mime: 'application/octet-stream' })
    getByIdMock.mockResolvedValue({ ext: 'bin' })

    const file = part('notes.bin', 'file:///stale/notes.bin', 'entry-office')
    const messages = [{ id: 'user-1', role: 'user', parts: [file] }] as UIMessage[]
    const attachments = collectFileAttachments(messages)
    const prepared = await prepareChatMessages(messages, {
      attachments,
      nativeSupport: { image: false, pdf: false, audio: false, video: false },
      isToolCapable: true,
      budget: { tokens: 5, tokenizer: { id: 'chars', count: (text: string) => text.length } }
    })
    const inline = (prepared[0].parts[0] as { text: string }).text
    const offset = Number(inline.match(/read_file\("notes\.bin", offset=(\d+)\)/)?.[1])
    expect(offset).toBeGreaterThan(0)

    const tail = await readFile({ filename: 'notes.bin', offset }, { attachments })
    expect(tail).toMatchObject({ text: expect.stringContaining('body'), totalChars: 'Office body'.length })
  })

  it('passes HTTP(S) media through without claiming to inspect its remote bytes', async () => {
    const content = await sdkContent(part('remote.png', 'https://example.com/remote.png'))

    expect(content).toEqual([
      expect.objectContaining({ type: 'file', mediaType: 'image/png', data: 'https://example.com/remote.png' })
    ])
  })

  it('uses managed bytes over FileManager MIME and FileEntry extension', async () => {
    readMock.mockResolvedValueOnce({ content: png.toString('base64'), mime: 'application/octet-stream' })
    getByIdMock.mockResolvedValueOnce({ ext: 'bin' })

    const content = await sdkContent(part('pixel.bin', 'file:///stale/pixel.bin', 'entry-pixel'))

    expect(content).toEqual([
      expect.objectContaining({
        type: 'file',
        mediaType: 'image/png',
        data: `data:image/png;base64,${png.toString('base64')}`
      })
    ])
    expect(readMock).toHaveBeenCalledTimes(1)
  })

  it('notes a ZIP disguised as PNG instead of sending native image bytes', async () => {
    readMock.mockResolvedValueOnce({
      content: Buffer.from('504b03041400000000000000000000000000000000000000000000', 'hex').toString('base64'),
      mime: 'image/png'
    })
    getByIdMock.mockResolvedValueOnce({ ext: 'png' })

    const content = await sdkContent(part('archive.png', 'file:///stale/archive.png', 'entry-archive'))

    expect(content).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('unsupported file type') })
    ])
    expect(readMock).toHaveBeenCalledTimes(1)
  })

  async function expectNoReadFilePointer(file: FileUIPart, body: string) {
    const messages = [{ id: 'user-1', role: 'user', parts: [file] }] as UIMessage[]
    const attachments = collectFileAttachments(messages)
    const prepared = await prepareChatMessages(messages, {
      attachments,
      nativeSupport: { image: true, pdf: true, audio: true, video: true },
      isToolCapable: true
    })
    const inline = (prepared[0].parts[0] as { text: string }).text

    expect(attachments).toEqual([])
    expect(inline).toContain(`[Truncated ${READ_FILE_PAGE_SIZE}/${body.length} chars.]`)
    expect(inline).not.toContain('read_file')
    expect(inline).not.toContain('TAIL')
    expect(prepared[0].parts.filter((entry) => entry.type === 'file')).toHaveLength(0)
  }

  it('does not advertise read_file for a long legacy text file without fileEntryId', async () => {
    const body = `${'a'.repeat(READ_FILE_PAGE_SIZE)}TAIL`
    const target = path.join(tmpDir, 'legacy-notes.txt')
    await fs.writeFile(target, body)

    await expectNoReadFilePointer(part('legacy-notes.txt', pathToFileURL(target).href), body)
  })

  it('does not advertise read_file for a long gateway data URL without fileEntryId', async () => {
    const body = `${'a'.repeat(READ_FILE_PAGE_SIZE)}TAIL`

    await expectNoReadFilePointer(
      part('gateway-notes.txt', `data:text/plain;base64,${Buffer.from(body).toString('base64')}`),
      body
    )
  })

  it('does not send a legacy local ZIP without fileEntryId as a native file part', async () => {
    const zip = Buffer.from('504b03041400000000000000000000000000000000000000000000', 'hex')
    const target = path.join(tmpDir, 'legacy-archive.zip')
    await fs.writeFile(target, zip)

    const content = await sdkContent(part('legacy-archive.zip', pathToFileURL(target).href))

    expect(content).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('unsupported file type') })
    ])
  })

  it('does not admit ZIP bytes as native PDF based only on a .pdf extension', async () => {
    readMock.mockResolvedValueOnce({
      content: Buffer.from('504b03041400000000000000000000000000000000000000000000', 'hex').toString('base64'),
      mime: 'application/pdf'
    })
    getByIdMock.mockResolvedValueOnce({ ext: 'pdf' })

    const content = await sdkContent(part('archive.pdf', 'file:///stale/archive.pdf', 'entry-archive'))

    expect(content).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('unsupported file type') })
    ])
  })
})
