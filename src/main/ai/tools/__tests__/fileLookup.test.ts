import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }
}))

const { getByIdMock, ocrMock } = vi.hoisted(() => ({
  getByIdMock: vi.fn<(id: string) => Promise<{ ext: string | null }>>(),
  ocrMock: vi.fn<() => Promise<string>>()
}))
vi.mock('@main/core/application', () => ({
  application: {
    get: (name: string) => (name === 'FileProcessingService' ? { ocrImage: ocrMock } : { getById: getByIdMock })
  }
}))

const { extractMock } = vi.hoisted(() => ({ extractMock: vi.fn<() => Promise<string>>() }))
vi.mock('@main/ai/messages/attachmentTextExtraction', () => ({
  extractDocumentText: extractMock,
  noExtractableTextNote: (name: string) => `No text in ${name}`
}))

import type { FileAttachmentRef } from '@main/ai/messages/attachmentTypes'

import { readFile, readFileModelOutput } from '../fileLookup'

const att = (handle: string): FileAttachmentRef => ({ fileEntryId: 'e1', handle, displayName: handle })
const ctx = (attachments: FileAttachmentRef[]) => ({ attachments })

afterEach(() => vi.clearAllMocks())

describe('readFile — text-only', () => {
  it('extracts document text', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'docx' })
    extractMock.mockResolvedValueOnce('word body')
    expect(await readFile({ filename: 'a.docx' }, ctx([att('a.docx')]))).toEqual({ text: 'word body', totalChars: 9 })
  })

  it('OCRs an image', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'png' })
    ocrMock.mockResolvedValueOnce('ocr text')
    const r = await readFile({ filename: 'a.png' }, ctx([att('a.png')]))
    expect(ocrMock).toHaveBeenCalledWith({ kind: 'entry', entryId: 'e1' }, undefined)
    expect(r).toEqual({ text: 'ocr text', totalChars: 8 })
  })

  it('returns a note for audio/video (no text form)', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'mp3' })
    const r = await readFile({ filename: 'a.mp3' }, ctx([att('a.mp3')]))
    expect(r).toMatchObject({ text: 'Cannot read audio file "a.mp3" as text.' })
    expect(extractMock).not.toHaveBeenCalled()
  })

  it('returns a note for unsupported binary types (no garbage decode)', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'zip' })
    const r = await readFile({ filename: 'a.zip' }, ctx([att('a.zip')]))
    expect(r).toMatchObject({ text: 'Cannot read the attached file "a.zip" as text (unsupported file type).' })
    expect(extractMock).not.toHaveBeenCalled()
    expect(ocrMock).not.toHaveBeenCalled()
  })

  it('returns a note when extraction is empty', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'pdf' })
    extractMock.mockResolvedValueOnce('   ')
    expect(await readFile({ filename: 'a.pdf' }, ctx([att('a.pdf')]))).toMatchObject({ text: 'No text in a.pdf' })
  })

  it('rejects a filename not in the allow-list (never reads the entry)', async () => {
    const r = await readFile({ filename: 'evil.pdf' }, ctx([att('a.txt')]))
    expect(r).toEqual({ error: 'No attached file named "evil.pdf". Available: a.txt' })
    expect(getByIdMock).not.toHaveBeenCalled()
  })

  it('sanitizes read failures (no internal detail leaks)', async () => {
    getByIdMock.mockRejectedValueOnce(new Error('ENOENT /Users/secret/path entry-xyz'))
    expect(await readFile({ filename: 'a.txt' }, ctx([att('a.txt')]))).toEqual({
      error: 'Failed to read attached file "a.txt".'
    })
  })

  it('rethrows on abort', async () => {
    const controller = new AbortController()
    controller.abort()
    getByIdMock.mockRejectedValueOnce(new Error('aborted'))
    await expect(readFile({ filename: 'a.txt' }, ctx([att('a.txt')]), controller.signal)).rejects.toThrow()
  })
})

describe('readFile — pagination', () => {
  it('slices by offset/limit and reports nextOffset', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'txt' })
    extractMock.mockResolvedValueOnce('0123456789')
    expect(await readFile({ filename: 'a.txt', offset: 2, limit: 3 }, ctx([att('a.txt')]))).toEqual({
      text: '234',
      totalChars: 10,
      nextOffset: 5
    })
  })

  it('omits nextOffset on the last page', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'txt' })
    extractMock.mockResolvedValueOnce('012')
    expect(await readFile({ filename: 'a.txt', offset: 0, limit: 100 }, ctx([att('a.txt')]))).toEqual({
      text: '012',
      totalChars: 3
    })
  })

  it('defaults limit to the page size (short text → whole, no nextOffset)', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'txt' })
    extractMock.mockResolvedValueOnce('short')
    expect(await readFile({ filename: 'a.txt' }, ctx([att('a.txt')]))).toEqual({ text: 'short', totalChars: 5 })
  })

  it('does not split a surrogate pair at the page boundary', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'txt' })
    extractMock.mockResolvedValueOnce('a😀b') // 'a'(1) + '😀'(2) + 'b'(1) = 4 code units
    expect(await readFile({ filename: 'a.txt', limit: 2 }, ctx([att('a.txt')]))).toEqual({
      text: 'a',
      totalChars: 4,
      nextOffset: 1
    })
  })

  it('advances past a high surrogate even when limit lands mid-pair (no empty-page loop)', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'txt' })
    extractMock.mockResolvedValueOnce('ab😀cd') // 😀 occupies code units 2-3
    // Without the forward-progress guard this returns text:'' nextOffset:2 → infinite paging.
    expect(await readFile({ filename: 'a.txt', offset: 2, limit: 1 }, ctx([att('a.txt')]))).toEqual({
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
