import fs from 'node:fs/promises'

import iconv from 'iconv-lite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }
}))

const { getVersionMock, getByIdMock, getPhysicalPathMock, readMock, cacheGet, cacheSet, ocrMock } = vi.hoisted(() => ({
  getVersionMock: vi.fn<() => Promise<{ mtime: number; size: number }>>(),
  getByIdMock: vi.fn<() => Promise<{ ext: string | null }>>(),
  getPhysicalPathMock: vi.fn<() => string>(),
  readMock: vi.fn<() => Promise<{ content: Uint8Array }>>(),
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  ocrMock: vi.fn<() => Promise<string>>()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const mocked = mockApplicationFactory({
    CacheService: { get: cacheGet, set: cacheSet },
    FileManager: {
      getVersion: getVersionMock,
      getById: getByIdMock,
      getPhysicalPath: getPhysicalPathMock,
      read: readMock
    }
  })
  const baseGet = mocked.application.get
  mocked.application.get = vi.fn((name: string) =>
    name === 'FileProcessingService' ? { ocrImage: ocrMock } : baseGet(name)
  )
  mocked.application.getPath = vi.fn((_key: string, filename?: string) => (filename ? `/tmp/${filename}` : '/tmp'))
  return mocked
})

const { zipFactoryMock, zipEntriesMock, zipEntryDataMock, zipCloseMock } = vi.hoisted(() => ({
  zipFactoryMock: vi.fn(),
  zipEntriesMock: vi.fn(),
  zipEntryDataMock: vi.fn(),
  zipCloseMock: vi.fn()
}))
vi.mock('node-stream-zip', () => ({
  default: {
    async: zipFactoryMock
  }
}))

const { parseOfficeAsyncMock } = vi.hoisted(() => ({
  parseOfficeAsyncMock: vi.fn<(_buffer: Buffer, _options: { tempFilesLocation: string }) => Promise<string>>()
}))
vi.mock('officeparser', () => ({ default: { parseOfficeAsync: parseOfficeAsyncMock } }))

const { wordExtractMock } = vi.hoisted(() => ({ wordExtractMock: vi.fn() }))
vi.mock('word-extractor', () => ({
  default: class {
    extract = wordExtractMock
  }
}))

const { extractPdfTextMock } = vi.hoisted(() => ({ extractPdfTextMock: vi.fn<() => Promise<string>>() }))
vi.mock('@main/utils/pdf', () => ({ extractPdfText: extractPdfTextMock }))

const { decodeTextMock } = vi.hoisted(() => ({ decodeTextMock: vi.fn<() => string>() }))
vi.mock('@main/utils/legacyFile', () => ({ decodeTextWithAutoEncoding: decodeTextMock }))

import { extractDocumentText, extractZipImageText, noExtractableTextNote } from '../attachmentTextExtraction'

const BYTES = new Uint8Array([1, 2, 3])

beforeEach(() => {
  zipFactoryMock.mockImplementation(() => ({
    entries: zipEntriesMock,
    entryData: zipEntryDataMock,
    close: zipCloseMock
  }))
  zipCloseMock.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

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
    parseOfficeAsyncMock.mockResolvedValueOnce(' office body ')
    expect(await extractDocumentText('e1')).toBe('office body')
    const [buffer, options] = parseOfficeAsyncMock.mock.calls[0]
    expect(Buffer.isBuffer(buffer)).toBe(true)
    expect(options).toEqual({ tempFilesLocation: '/tmp' })
  })

  it('decodes text/code files with auto encoding', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: 'md' })
    decodeTextMock.mockReturnValueOnce(' markdown ')
    expect(await extractDocumentText('e1')).toBe('markdown')
    expect(decodeTextMock).toHaveBeenCalledWith(expect.any(Buffer))
  })

  it('falls back to text decode for legacy-encoded text when the entry has no ext', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: null })
    const text = '这是一个没有扩展名的 GBK 文本文件，用于验证自动编码检测。'
    const content = iconv.encode(text, 'gbk')
    readMock.mockResolvedValueOnce({ content })
    expect(await extractDocumentText('e1')).toBe(text)
    expect(decodeTextMock).not.toHaveBeenCalled()
  })

  it('rejects ambiguous short legacy-encoded files instead of returning mojibake', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: null })
    readMock.mockResolvedValueOnce({ content: iconv.encode('中文', 'big5') })
    expect(await extractDocumentText('e1')).toBeNull()
    expect(decodeTextMock).not.toHaveBeenCalled()
  })

  it('does not decode an extensionless binary file as text', async () => {
    getByIdMock.mockResolvedValueOnce({ ext: null })
    readMock.mockResolvedValueOnce({ content: Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj') })
    expect(await extractDocumentText('e1')).toBeNull()
    expect(decodeTextMock).not.toHaveBeenCalled()
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

describe('extractZipImageText', () => {
  beforeEach(() => {
    getVersionMock.mockResolvedValue({ mtime: 1, size: 2 })
    getPhysicalPathMock.mockReturnValue('/tmp/archive.zip')
    cacheGet.mockReturnValue(undefined)
    zipEntryDataMock.mockResolvedValue(Buffer.from([1, 2, 3]))
    vi.spyOn(fs, 'mkdtemp').mockResolvedValue('/tmp/chat-archive-test')
    vi.spyOn(fs, 'writeFile').mockResolvedValue()
    vi.spyOn(fs, 'rm').mockResolvedValue()
  })

  it('OCRs supported images and reports ignored non-image files', async () => {
    const image = { name: 'pages/PAGE.PNG', isDirectory: false, encrypted: false, size: 3 }
    zipEntriesMock.mockResolvedValue({
      [image.name]: image,
      'notes.txt': { name: 'notes.txt', isDirectory: false, encrypted: false, size: 4 }
    })
    ocrMock.mockResolvedValueOnce('  page body  ')

    await expect(extractZipImageText('e1')).resolves.toBe(
      'Image "pages/PAGE.PNG":\npage body\n\n[Ignored 1 non-image file(s) in the ZIP archive.]'
    )
    expect(zipFactoryMock).toHaveBeenCalledWith({ file: '/tmp/archive.zip' })
    expect(zipEntryDataMock).toHaveBeenCalledWith(image)
    expect(fs.writeFile).toHaveBeenCalledWith('/tmp/chat-archive-test/0.png', expect.any(Buffer))
    expect(ocrMock).toHaveBeenCalledWith({ kind: 'path', path: '/tmp/chat-archive-test/0.png' }, undefined)
    expect(cacheSet).toHaveBeenCalledWith(
      'zip-image-ocr:e1:1:2',
      expect.stringContaining('page body'),
      expect.any(Number)
    )
    expect(zipCloseMock).toHaveBeenCalled()
    expect(fs.rm).toHaveBeenCalledWith('/tmp/chat-archive-test', { recursive: true, force: true })
  })

  it('returns a visible note when the ZIP contains no supported images', async () => {
    zipEntriesMock.mockResolvedValue({
      'notes.txt': { name: 'notes.txt', isDirectory: false, encrypted: false, size: 4 }
    })

    await expect(extractZipImageText('e1')).resolves.toBe('No supported image files found in this ZIP archive.')
    expect(fs.mkdtemp).not.toHaveBeenCalled()
    expect(ocrMock).not.toHaveBeenCalled()
  })

  it('rejects ZIPs with too many entries before reading entry data', async () => {
    zipEntriesMock.mockResolvedValue(
      Object.fromEntries(
        Array.from({ length: 1001 }, (_, index) => [
          `${index}.png`,
          { name: `${index}.png`, isDirectory: false, encrypted: false, size: 1 }
        ])
      )
    )

    await expect(extractZipImageText('e1')).rejects.toThrow('ZIP has too many entries')
    expect(zipEntryDataMock).not.toHaveBeenCalled()
    expect(ocrMock).not.toHaveBeenCalled()
  })

  it('rejects ZIPs whose declared uncompressed size exceeds the limit', async () => {
    zipEntriesMock.mockResolvedValue({
      'large.png': {
        name: 'large.png',
        isDirectory: false,
        encrypted: false,
        size: 100 * 1024 * 1024 + 1
      }
    })

    await expect(extractZipImageText('e1')).rejects.toThrow('ZIP uncompressed size exceeds')
    expect(zipEntryDataMock).not.toHaveBeenCalled()
  })

  it('limits OCR work and reports additional images', async () => {
    zipEntriesMock.mockResolvedValue(
      Object.fromEntries(
        Array.from({ length: 21 }, (_, index) => [
          `${index}.png`,
          { name: `${index}.png`, isDirectory: false, encrypted: false, size: 1 }
        ])
      )
    )
    ocrMock.mockResolvedValue('text')

    const text = await extractZipImageText('e1')
    expect(ocrMock).toHaveBeenCalledTimes(20)
    expect(text).toContain('[Skipped 1 image(s) beyond the 20-image limit.]')
  })

  it('skips an oversized image before decompressing it', async () => {
    zipEntriesMock.mockResolvedValue({
      'large.png': {
        name: 'large.png',
        isDirectory: false,
        encrypted: false,
        size: 10 * 1024 * 1024 + 1
      }
    })

    await expect(extractZipImageText('e1')).resolves.toContain('[image exceeds the 10485760-byte limit].')
    expect(zipEntryDataMock).not.toHaveBeenCalled()
    expect(ocrMock).not.toHaveBeenCalled()
  })

  it('uses the versioned cache without reopening the ZIP', async () => {
    cacheGet.mockReturnValueOnce('cached ZIP OCR')
    await expect(extractZipImageText('e1')).resolves.toBe('cached ZIP OCR')
    expect(getPhysicalPathMock).not.toHaveBeenCalled()
    expect(zipFactoryMock).not.toHaveBeenCalled()
  })
})
