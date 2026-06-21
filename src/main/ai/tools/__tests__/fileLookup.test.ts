import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }
}))

const { getByIdMock, readMock } = vi.hoisted(() => ({
  getByIdMock: vi.fn<(id: string) => Promise<{ ext: string | null }>>(),
  readMock: vi.fn<(id: string, opts: { encoding: 'base64' }) => Promise<{ content: string; mime: string }>>()
}))

vi.mock('@main/core/application', () => ({
  application: { get: () => ({ getById: getByIdMock, read: readMock }) }
}))

const { extractDocumentTextMock } = vi.hoisted(() => ({ extractDocumentTextMock: vi.fn<() => Promise<string>>() }))
vi.mock('@main/utils/file/documentExtraction', () => ({ extractDocumentText: extractDocumentTextMock }))

const { ocrMock } = vi.hoisted(() => ({ ocrMock: vi.fn<() => Promise<string>>() }))
vi.mock('@main/features/fileProcessing', () => ({ ocrImageToText: ocrMock }))

import type { FileAttachmentRef, FileToolCapabilities } from '../adapters/aiSdk/context'
import { readFile, readFileModelOutput } from '../fileLookup'

const VISION_MEDIA: FileToolCapabilities = {
  isVision: true,
  isAudio: true,
  isVideo: true,
  acceptsMediaInToolResult: true
}
const NON_VISION: FileToolCapabilities = {
  isVision: false,
  isAudio: false,
  isVideo: false,
  acceptsMediaInToolResult: true
}
const TEXT_ONLY: FileToolCapabilities = {
  isVision: true,
  isAudio: true,
  isVideo: true,
  acceptsMediaInToolResult: false
}

const att = (filename: string, mediaType: string): FileAttachmentRef => ({ fileEntryId: 'e1', filename, mediaType })
const ctx = (caps: FileToolCapabilities, attachments: FileAttachmentRef[]) => ({ caps, attachments })

afterEach(() => vi.clearAllMocks())

describe('readFile — capability matrix', () => {
  it('returns native media for an image on a vision model with media-capable provider', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'png' })
    const result = await readFile({ filename: 'x.png' }, ctx(VISION_MEDIA, [att('x.png', 'image/png')]))
    expect(result).toEqual({ kind: 'media', fileEntryId: 'e1', mediaType: 'image/png', filename: 'x.png' })
    expect(ocrMock).not.toHaveBeenCalled()
  })

  it('OCRs an image for a non-vision model', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'png' })
    ocrMock.mockResolvedValueOnce('recognized text')
    const result = await readFile({ filename: 'x.png' }, ctx(NON_VISION, [att('x.png', 'image/png')]))
    expect(ocrMock).toHaveBeenCalledWith({ kind: 'entry', entryId: 'e1' }, undefined)
    expect(result).toEqual({ kind: 'text', text: 'recognized text', totalChars: 'recognized text'.length })
  })

  it('OCRs an image when the provider cannot carry media in a tool result', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'jpg' })
    ocrMock.mockResolvedValueOnce('ocr')
    const result = await readFile({ filename: 'x.jpg' }, ctx(TEXT_ONLY, [att('x.jpg', 'image/jpeg')]))
    expect(ocrMock).toHaveBeenCalled()
    expect(result).toMatchObject({ kind: 'text', text: 'ocr' })
  })

  it('returns native media for audio/video on a media-capable provider', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'mp3' })
    const result = await readFile({ filename: 'clip.mp3' }, ctx(VISION_MEDIA, [att('clip.mp3', 'audio/mpeg')]))
    expect(result).toEqual({ kind: 'media', fileEntryId: 'e1', mediaType: 'audio/mpeg', filename: 'clip.mp3' })
    expect(extractDocumentTextMock).not.toHaveBeenCalled()
  })

  it('errors (never garbage-decodes) for audio/video the provider cannot carry', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'mp4' })
    const result = await readFile({ filename: 'v.mp4' }, ctx(TEXT_ONLY, [att('v.mp4', 'video/mp4')]))
    expect(result).toEqual({ error: 'Cannot read video file "v.mp4" — this model does not accept video input.' })
    expect(extractDocumentTextMock).not.toHaveBeenCalled()
  })

  it('errors for audio when the model is not audio-capable, even on a media provider', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'mp3' })
    const result = await readFile({ filename: 'clip.mp3' }, ctx(NON_VISION, [att('clip.mp3', 'audio/mpeg')]))
    expect(result).toEqual({ error: 'Cannot read audio file "clip.mp3" — this model does not accept audio input.' })
  })

  it('returns native media for a PDF on a media-capable provider', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'pdf' })
    const result = await readFile({ filename: 'doc.pdf' }, ctx(VISION_MEDIA, [att('doc.pdf', 'application/pdf')]))
    expect(result).toEqual({ kind: 'media', fileEntryId: 'e1', mediaType: 'application/pdf', filename: 'doc.pdf' })
    expect(extractDocumentTextMock).not.toHaveBeenCalled()
  })

  it('extracts PDF text when the provider cannot carry media', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'pdf' })
    extractDocumentTextMock.mockResolvedValueOnce('pdf text')
    const result = await readFile({ filename: 'doc.pdf' }, ctx(TEXT_ONLY, [att('doc.pdf', 'application/pdf')]))
    expect(extractDocumentTextMock).toHaveBeenCalledWith('e1')
    expect(result).toMatchObject({ kind: 'text', text: 'pdf text' })
  })

  it('always extracts office docs as text, regardless of capability', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'docx' })
    extractDocumentTextMock.mockResolvedValueOnce('word text')
    const result = await readFile(
      { filename: 'report.docx' },
      ctx(VISION_MEDIA, [att('report.docx', 'application/octet-stream')])
    )
    expect(result).toMatchObject({ kind: 'text', text: 'word text' })
  })

  it('paginates text with offset/limit and reports nextOffset', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'txt' })
    extractDocumentTextMock.mockResolvedValueOnce('0123456789')
    const result = await readFile(
      { filename: 'a.txt', offset: 2, limit: 3 },
      ctx(TEXT_ONLY, [att('a.txt', 'text/plain')])
    )
    expect(result).toEqual({ kind: 'text', text: '234', totalChars: 10, nextOffset: 5 })
  })

  it('rejects a filename not in the request allow-list (never reads the entry)', async () => {
    const result = await readFile({ filename: 'evil.pdf' }, ctx(VISION_MEDIA, [att('a.txt', 'text/plain')]))
    expect(result).toEqual({ error: 'No attached file named "evil.pdf". Available: a.txt' })
    expect(getByIdMock).not.toHaveBeenCalled()
  })

  it('returns an error object (not throw) on read failure', async () => {
    getByIdMock.mockRejectedValueOnce(new Error('missing entry'))
    const result = await readFile({ filename: 'a.txt' }, ctx(VISION_MEDIA, [att('a.txt', 'text/plain')]))
    expect(result).toEqual({ error: 'missing entry' })
  })

  it('rethrows on abort', async () => {
    const controller = new AbortController()
    controller.abort()
    getByIdMock.mockRejectedValueOnce(new Error('aborted'))
    await expect(
      readFile({ filename: 'a.txt' }, ctx(VISION_MEDIA, [att('a.txt', 'text/plain')]), controller.signal)
    ).rejects.toThrow()
  })
})

describe('readFileModelOutput', () => {
  it('projects text results to a text tool output', async () => {
    const out = await readFileModelOutput({ kind: 'text', text: 'hello', totalChars: 5 })
    expect(out).toEqual({ type: 'text', value: 'hello' })
  })

  it('appends a continuation note when paged', async () => {
    const out = await readFileModelOutput({ kind: 'text', text: 'abc', totalChars: 10, nextOffset: 3 })
    expect(out.type).toBe('text')
    expect((out as { value: string }).value).toContain('offset=3')
  })

  it('re-reads image media to base64 image-data', async () => {
    readMock.mockResolvedValueOnce({ content: 'BASE64IMG', mime: 'image/png' })
    const out = await readFileModelOutput({ kind: 'media', fileEntryId: 'e1', mediaType: 'image/png' })
    expect(out).toEqual({ type: 'content', value: [{ type: 'image-data', data: 'BASE64IMG', mediaType: 'image/png' }] })
  })

  it('re-reads non-image media to base64 file-data', async () => {
    readMock.mockResolvedValueOnce({ content: 'BASE64PDF', mime: 'application/pdf' })
    const out = await readFileModelOutput({
      kind: 'media',
      fileEntryId: 'e1',
      mediaType: 'application/pdf',
      filename: 'd.pdf'
    })
    expect(out).toEqual({
      type: 'content',
      value: [{ type: 'file-data', data: 'BASE64PDF', mediaType: 'application/pdf', filename: 'd.pdf' }]
    })
  })

  it('projects an error to a text note', async () => {
    const out = await readFileModelOutput({ error: 'boom' })
    expect(out).toEqual({ type: 'text', value: 'Failed to read file: boom' })
  })
})
