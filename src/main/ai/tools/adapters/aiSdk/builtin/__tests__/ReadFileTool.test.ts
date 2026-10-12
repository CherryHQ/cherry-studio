import type { ToolExecutionOptions } from '@ai-sdk/provider-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { getByIdMock, mediaAnalysisMock, ocrMock } = vi.hoisted(() => ({
  getByIdMock: vi.fn<(id: string) => Promise<{ ext: string | null }>>(),
  mediaAnalysisMock: vi.fn<(file: { kind: 'entry'; entryId: string }, signal?: AbortSignal) => Promise<string>>(),
  ocrMock: vi.fn<() => Promise<string>>()
}))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const mocked = mockApplicationFactory({
    FileManager: { getById: getByIdMock }
  })
  const delegated = mocked.application.get.getMockImplementation()
  mocked.application.get.mockImplementation((name: string) => {
    if (name === 'MediaAnalysisService') return { analyzeToFullText: mediaAnalysisMock }
    if (name === 'FileProcessingService') return { ocrImage: ocrMock }
    return delegated?.call(mocked.application, name)
  })
  return mocked
})

const { extractMock } = vi.hoisted(() => ({ extractMock: vi.fn<() => Promise<string | null>>() }))
vi.mock('@main/ai/messages/attachmentTextExtraction', () => ({
  extractDocumentText: extractMock,
  noExtractableTextNote: (name: string) => `No text in ${name}`
}))

import type { FileAttachmentRef } from '@main/ai/messages/attachmentTypes'
import type { ReadFileInput } from '@shared/ai/builtinTools'

import { createReadFileToolEntry, readFile, readFileModelOutput } from '../ReadFileTool'

const att = (handle: string): FileAttachmentRef => ({ fileEntryId: 'e1', handle, displayName: handle })
const ctx = (attachments: FileAttachmentRef[]) => ({ attachments })

// offset/limit are plain optionals — omitting one means "use the default", so pass `rest` through.
const input = (rest: { filename: string; offset?: number; limit?: number }): ReadFileInput => rest

afterEach(() => {
  getByIdMock.mockReset()
  mediaAnalysisMock.mockReset()
  ocrMock.mockReset()
  extractMock.mockReset()
})

describe('readFile — extracted content', () => {
  it('extracts document text', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'docx' })
    extractMock.mockResolvedValueOnce('word body')
    expect(await readFile(input({ filename: 'a.docx' }), ctx([att('a.docx')]))).toEqual({
      text: 'word body',
      totalChars: 9
    })
  })

  it('extracts an extensionless text file', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: null })
    extractMock.mockResolvedValueOnce('license body')
    expect(await readFile(input({ filename: 'LICENSE' }), ctx([att('LICENSE')]))).toEqual({
      text: 'license body',
      totalChars: 12
    })
  })

  it('returns an unsupported note for an extensionless binary file', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: null })
    extractMock.mockResolvedValueOnce(null)
    expect(await readFile(input({ filename: 'payload' }), ctx([att('payload')]))).toEqual({
      text: 'Cannot read the attached file "payload" as text (unsupported file type).',
      totalChars: 72
    })
  })

  it('OCRs an image', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'png' })
    ocrMock.mockResolvedValueOnce('ocr text')
    const r = await readFile(input({ filename: 'a.png' }), ctx([att('a.png')]))
    expect(ocrMock).toHaveBeenCalledWith({ kind: 'entry', entryId: 'e1' }, undefined)
    expect(r).toEqual({ text: 'ocr text', totalChars: 8 })
  })

  it.each(['mp3', 'mp4', 'webm'])('returns paged full media analysis for .%s attachments', async (ext) => {
    getByIdMock.mockResolvedValueOnce({ ext })
    mediaAnalysisMock.mockResolvedValueOnce('[00:00] alpha\n[00:10] beta\n[00:20] gamma')

    const r = await readFile(input({ filename: `media.${ext}`, offset: 14, limit: 12 }), ctx([att(`media.${ext}`)]))

    expect(r).toEqual({ text: '[00:10] beta', totalChars: 40, nextOffset: 26 })
    expect(mediaAnalysisMock).toHaveBeenCalledWith({ kind: 'entry', entryId: 'e1' }, undefined)
    expect(extractMock).not.toHaveBeenCalled()
  })

  it.each(['mp4', 'webm'])('sanitizes .%s media analysis failures', async (ext) => {
    getByIdMock.mockResolvedValueOnce({ ext })
    mediaAnalysisMock.mockRejectedValueOnce(new Error(`probe failed: /Users/secret/video.${ext}`))

    await expect(readFile(input({ filename: `clip.${ext}` }), ctx([att(`clip.${ext}`)]))).resolves.toEqual({
      error: `Failed to read attached file "clip.${ext}".`
    })
  })

  it.each(['mp4', 'webm'])('rethrows cancellation from .%s media analysis', async (ext) => {
    const controller = new AbortController()
    getByIdMock.mockResolvedValueOnce({ ext })
    mediaAnalysisMock.mockImplementationOnce(async () => {
      controller.abort()
      throw new DOMException('Aborted', 'AbortError')
    })

    await expect(
      readFile(input({ filename: `clip.${ext}` }), ctx([att(`clip.${ext}`)]), controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('returns a note for unsupported binary types (no garbage decode)', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'zip' })
    const r = await readFile(input({ filename: 'a.zip' }), ctx([att('a.zip')]))
    expect(r).toMatchObject({ text: 'Cannot read the attached file "a.zip" as text (unsupported file type).' })
    expect(extractMock).not.toHaveBeenCalled()
    expect(ocrMock).not.toHaveBeenCalled()
  })

  it('returns a note when extraction is empty', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'pdf' })
    extractMock.mockResolvedValueOnce('   ')
    expect(await readFile(input({ filename: 'a.pdf' }), ctx([att('a.pdf')]))).toMatchObject({
      text: 'No text in a.pdf'
    })
  })

  it('rejects a filename not in the allow-list (never reads the entry)', async () => {
    const r = await readFile(input({ filename: 'evil.pdf' }), ctx([att('a.txt')]))
    expect(r).toEqual({ error: 'No attached file named "evil.pdf". Available: a.txt' })
    expect(getByIdMock).not.toHaveBeenCalled()
  })

  it('refuses a .webm name that is not on the allow-list before reading it', async () => {
    const r = await readFile(input({ filename: 'clip.webm' }), ctx([att('notes.txt')]))
    expect(r).toEqual({ error: 'No attached file named "clip.webm". Available: notes.txt' })
    expect(getByIdMock).not.toHaveBeenCalled()
    expect(mediaAnalysisMock).not.toHaveBeenCalled()
  })

  it('sanitizes read failures (no internal detail leaks)', async () => {
    getByIdMock.mockRejectedValueOnce(new Error('ENOENT /Users/secret/path entry-xyz'))
    expect(await readFile(input({ filename: 'a.txt' }), ctx([att('a.txt')]))).toEqual({
      error: 'Failed to read attached file "a.txt".'
    })
  })

  it('rethrows on abort', async () => {
    const controller = new AbortController()
    controller.abort()
    getByIdMock.mockRejectedValueOnce(new Error('aborted'))
    await expect(readFile(input({ filename: 'a.txt' }), ctx([att('a.txt')]), controller.signal)).rejects.toThrow()
  })
})

describe('readFile — pagination', () => {
  it('slices by offset/limit and reports nextOffset', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'txt' })
    extractMock.mockResolvedValueOnce('0123456789')
    expect(await readFile(input({ filename: 'a.txt', offset: 2, limit: 3 }), ctx([att('a.txt')]))).toEqual({
      text: '234',
      totalChars: 10,
      nextOffset: 5
    })
  })

  it('omits nextOffset on the last page', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'txt' })
    extractMock.mockResolvedValueOnce('012')
    expect(await readFile(input({ filename: 'a.txt', offset: 0, limit: 100 }), ctx([att('a.txt')]))).toEqual({
      text: '012',
      totalChars: 3
    })
  })

  it('defaults limit to the page size (short text → whole, no nextOffset)', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'txt' })
    extractMock.mockResolvedValueOnce('short')
    expect(await readFile(input({ filename: 'a.txt' }), ctx([att('a.txt')]))).toEqual({ text: 'short', totalChars: 5 })
  })

  it('does not split a surrogate pair at the page boundary', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'txt' })
    extractMock.mockResolvedValueOnce('a😀b') // 'a'(1) + '😀'(2) + 'b'(1) = 4 code units
    expect(await readFile(input({ filename: 'a.txt', limit: 2 }), ctx([att('a.txt')]))).toEqual({
      text: 'a',
      totalChars: 4,
      nextOffset: 1
    })
  })

  it('advances past a high surrogate even when limit lands mid-pair (no empty-page loop)', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'txt' })
    extractMock.mockResolvedValueOnce('ab😀cd') // 😀 occupies code units 2-3
    // Without the forward-progress guard this returns text:'' nextOffset:2 → infinite paging.
    expect(await readFile(input({ filename: 'a.txt', offset: 2, limit: 1 }), ctx([att('a.txt')]))).toEqual({
      text: '😀',
      totalChars: 6,
      nextOffset: 4
    })
  })
})

describe('readFileModelOutput', () => {
  it('projects a text result', () => {
    expect(readFileModelOutput({ text: 'hi', totalChars: 2 })).toEqual({ type: 'text', value: 'hi' })
  })

  it('appends a paging note when nextOffset is set', () => {
    const out = readFileModelOutput({ text: 'abc', totalChars: 10, nextOffset: 3 })
    expect(out.type).toBe('text')
    expect((out as { value: string }).value).toContain('offset=3')
  })

  it('projects an error to text', () => {
    expect(readFileModelOutput({ error: 'boom' })).toEqual({ type: 'text', value: 'boom' })
  })
})

describe('createReadFileToolEntry', () => {
  it('threads the AI SDK Agent request allow-list and cancellation signal into media analysis', async () => {
    const controller = new AbortController()
    getByIdMock.mockResolvedValueOnce({ ext: 'mp4' })
    mediaAnalysisMock.mockResolvedValueOnce('[00:00] agent result')
    const entry = createReadFileToolEntry()
    const execute = entry.tool.execute as (args: ReadFileInput, options: ToolExecutionOptions) => Promise<unknown>

    const result = await execute(
      { filename: 'clip.mp4' },
      {
        toolCallId: 'call-1',
        messages: [],
        experimental_context: {
          requestId: 'request-1',
          abortSignal: controller.signal,
          fileAttachments: [att('clip.mp4')]
        }
      }
    )

    expect(result).toEqual({ text: '[00:00] agent result', totalChars: 20 })
    expect(mediaAnalysisMock).toHaveBeenCalledWith({ kind: 'entry', entryId: 'e1' }, controller.signal)
  })

  it('carries a persist-only text-field codec (in-flight output is text, so the codec never fires there)', async () => {
    const entry = createReadFileToolEntry()
    expect(entry.truncatable).toBeUndefined()
    const output = { text: 'page body', totalChars: 9 }
    expect(entry.codec!.deflate(output)).toEqual({ skeleton: output, blobs: [{ key: '/text', text: 'page body' }] })
    expect(entry.codec!.deflate({ error: 'No attached file named "x".' })).toBeNull()
  })
})
