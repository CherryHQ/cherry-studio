import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }
}))

const { getVersionMock, getByIdMock, readMock, cacheGet, cacheSet } = vi.hoisted(() => ({
  getVersionMock: vi.fn<() => Promise<{ mtime: number; size: number }>>(),
  getByIdMock: vi.fn<() => Promise<{ ext: string | null }>>(),
  readMock: vi.fn<() => Promise<{ content: Uint8Array }>>(),
  cacheGet: vi.fn(),
  cacheSet: vi.fn()
}))

vi.mock('@application', () => ({
  application: {
    get: (name: string) =>
      name === 'CacheService'
        ? { get: cacheGet, set: cacheSet }
        : { getVersion: getVersionMock, getById: getByIdMock, read: readMock },
    getPath: () => '/tmp'
  }
}))

const { officeConvertMock } = vi.hoisted(() => ({ officeConvertMock: vi.fn() }))
vi.mock('officeparser', () => ({
  OfficeConverter: {
    convert: officeConvertMock
  }
}))

const { wordExtractMock } = vi.hoisted(() => ({ wordExtractMock: vi.fn() }))
vi.mock('word-extractor', () => ({
  default: class {
    extract = wordExtractMock
  }
}))

const { extractPdfTextMock } = vi.hoisted(() => ({ extractPdfTextMock: vi.fn<() => Promise<string>>() }))
vi.mock('@main/utils/pdf', () => ({ extractPdfText: extractPdfTextMock }))

const { decodeTextMock } = vi.hoisted(() => ({ decodeTextMock: vi.fn<() => string>() }))
vi.mock('@main/utils/file', () => ({ decodeTextWithAutoEncoding: decodeTextMock }))

import { extractDocumentText, noExtractableTextNote } from '../attachmentTextExtraction'

const BYTES = new Uint8Array([1, 2, 3])

afterEach(() => vi.clearAllMocks())

describe('extractDocumentText — dispatch on entry ext, bytes via FileManager.read', () => {
  beforeEach(() => {
    getVersionMock.mockResolvedValue({ mtime: 1, size: 2 })
    cacheGet.mockReturnValue(undefined)
    readMock.mockResolvedValue({ content: BYTES })
  })

  it('extracts PDF via extractPdfText on the raw bytes (no physical path)', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'pdf' })
    extractPdfTextMock.mockResolvedValueOnce('  pdf body  ')
    expect(await extractDocumentText('e1')).toBe('pdf body')
    expect(extractPdfTextMock).toHaveBeenCalledWith(BYTES)
  })

  it('normalizes ext case (PDF → pdf)', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'PDF' })
    extractPdfTextMock.mockResolvedValueOnce('x')
    expect(await extractDocumentText('e1')).toBe('x')
    expect(extractPdfTextMock).toHaveBeenCalled()
  })

  it('extracts .doc via word-extractor (buffer)', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'doc' })
    wordExtractMock.mockResolvedValueOnce({ getBody: () => ' word body ' })
    expect(await extractDocumentText('e1')).toBe('word body')
    expect(wordExtractMock).toHaveBeenCalledWith(expect.any(Buffer))
  })

  it('extracts office formats via officeparser (buffer)', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'docx' })
    officeConvertMock.mockResolvedValueOnce({ value: ' office body ' })
    expect(await extractDocumentText('e1')).toBe('office body')
    expect(officeConvertMock).toHaveBeenCalledWith(
      expect.any(Buffer),
      'text',
      expect.objectContaining({
        parseConfig: expect.objectContaining({ fileType: 'docx' }),
        generatorConfig: expect.objectContaining({
          textConfig: expect.objectContaining({
            newlineDelimiter: '\n',
            preserveLayout: true
          })
        })
      })
    )
  })

  it('returns empty text for unsupported legacy Excel files instead of binary-decoding them', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'xls' })

    expect(await extractDocumentText('e1')).toBe('')
    expect(officeConvertMock).not.toHaveBeenCalled()
    expect(decodeTextMock).not.toHaveBeenCalled()
  })

  it('decodes text/code files with auto encoding', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'md' })
    decodeTextMock.mockReturnValueOnce(' markdown ')
    expect(await extractDocumentText('e1')).toBe('markdown')
    expect(decodeTextMock).toHaveBeenCalledWith(expect.any(Buffer))
  })

  it('falls back to text decode when the entry has no ext', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: null })
    decodeTextMock.mockReturnValueOnce('plain')
    expect(await extractDocumentText('e1')).toBe('plain')
  })

  it('caches by entry version and skips re-extraction on hit', async () => {
    cacheGet.mockReturnValueOnce('cached text')
    expect(await extractDocumentText('e1')).toBe('cached text')
    expect(getByIdMock).not.toHaveBeenCalled()
    expect(readMock).not.toHaveBeenCalled()
  })

  it('writes the extracted text to cache', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'txt' })
    decodeTextMock.mockReturnValueOnce('hello')
    await extractDocumentText('e1')
    expect(cacheSet).toHaveBeenCalledWith('doc-extraction:e1:1:2', 'hello', expect.any(Number))
  })

  it('throws the abort reason when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(extractDocumentText('e1', { signal: controller.signal })).rejects.toBeDefined()
    expect(getByIdMock).not.toHaveBeenCalled()
  })
})

describe('noExtractableTextNote', () => {
  it('names the file and hints at a scanned/image-only doc', () => {
    expect(noExtractableTextNote('scan.pdf')).toContain('scan.pdf')
    expect(noExtractableTextNote('scan.pdf')).toContain('scanned')
  })
})
