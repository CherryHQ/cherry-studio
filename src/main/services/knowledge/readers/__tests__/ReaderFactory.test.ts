import type { KnowledgeItemOf } from '@shared/data/types/knowledge'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.hoisted(() => vi.fn())
const loggerWarnMock = vi.hoisted(() => vi.fn())
const getPhysicalPathMock = vi.hoisted(() => vi.fn())
const customReaderSpies = vi.hoisted(() => ({
  drafts: vi.fn(async (filePath: string) => [{ metadata: { reader: 'drafts', filePath } }]),
  epub: vi.fn(async (filePath: string) => [{ metadata: { reader: 'epub', filePath } }])
}))
const readerSpies = vi.hoisted(() => ({
  csv: vi.fn(async (filePath: string) => [{ metadata: { reader: 'csv', filePath } }]),
  docx: vi.fn(async (filePath: string) => [{ metadata: { reader: 'docx', filePath } }]),
  json: vi.fn(async (filePath: string) => [{ metadata: { reader: 'json', filePath } }]),
  markdown: vi.fn(async (filePath: string) => [{ metadata: { reader: 'markdown', filePath } }]),
  pdf: vi.fn(async (filePath: string) => [{ metadata: { reader: 'pdf', filePath } }]),
  text: vi.fn(async (filePath: string) => [{ metadata: { reader: 'text', filePath } }])
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: loggerWarnMock,
      error: vi.fn()
    })
  }
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    FileManager: {
      getPhysicalPath: getPhysicalPathMock
    }
  } as Parameters<typeof mockApplicationFactory>[0])
})

vi.mock('electron', () => ({
  net: {
    fetch: fetchMock
  }
}))

vi.mock('@vectorstores/readers/csv', () => ({
  CSVReader: class {
    loadData = readerSpies.csv
  }
}))

vi.mock('@vectorstores/readers/docx', () => ({
  DocxReader: class {
    loadData = readerSpies.docx
  }
}))

vi.mock('@vectorstores/readers/json', () => ({
  JSONReader: class {
    loadData = readerSpies.json
  }
}))

vi.mock('@vectorstores/readers/markdown', () => ({
  MarkdownReader: class {
    loadData = readerSpies.markdown
  }
}))

vi.mock('@vectorstores/readers/pdf', () => ({
  PDFReader: class {
    loadData = readerSpies.pdf
  }
}))

vi.mock('@vectorstores/readers/text', () => ({
  TextFileReader: class {
    loadData = readerSpies.text
  }
}))

vi.mock('../files/DraftsExportReader', () => ({
  DraftsExportReader: class {
    loadData = customReaderSpies.drafts
  }
}))

vi.mock('../files/EpubReader', () => ({
  EpubReader: class {
    loadData = customReaderSpies.epub
  }
}))

const { loadKnowledgeItemDocuments } = await import('../KnowledgeReader')

const FILE_ENTRY_ID = '019606a0-0000-7000-8000-000000000501'
const PROCESSED_FILE_ENTRY_ID = '019606a0-0000-7000-8000-000000000502'

function createFileItem(ext: string, sourcePath?: string): KnowledgeItemOf<'file'> {
  return {
    id: 'item-1',
    baseId: 'base-1',
    groupId: null,
    type: 'file',
    status: 'idle',
    error: null,
    createdAt: '2026-04-03T00:00:00.000Z',
    updatedAt: '2026-04-03T00:00:00.000Z',
    data: {
      source: sourcePath ?? `/tmp/sample${ext}`,
      fileEntryId: FILE_ENTRY_ID
    }
  }
}

function createNoteItem(content: string, sourceUrl?: string): KnowledgeItemOf<'note'> {
  return {
    id: 'note-1',
    baseId: 'base-1',
    groupId: null,
    type: 'note',
    status: 'idle',
    error: null,
    createdAt: '2026-04-03T00:00:00.000Z',
    updatedAt: '2026-04-03T00:00:00.000Z',
    data: {
      source: sourceUrl ?? 'note-1',
      content,
      sourceUrl
    }
  }
}

function createUrlItem(): KnowledgeItemOf<'url'> {
  return {
    id: 'url-1',
    baseId: 'base-1',
    groupId: null,
    type: 'url',
    status: 'idle',
    error: null,
    createdAt: '2026-04-03T00:00:00.000Z',
    updatedAt: '2026-04-03T00:00:00.000Z',
    data: {
      source: 'https://example.com',
      url: 'https://example.com'
    }
  }
}

function createDirectoryItem(): KnowledgeItemOf<'directory'> {
  return {
    id: 'directory-1',
    baseId: 'base-1',
    groupId: null,
    type: 'directory',
    status: 'idle',
    error: null,
    createdAt: '2026-04-03T00:00:00.000Z',
    updatedAt: '2026-04-03T00:00:00.000Z',
    data: {
      source: '/tmp/example-directory',
      path: '/tmp/example-directory'
    }
  }
}

describe('loadKnowledgeItemDocuments', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    loggerWarnMock.mockReset()
    getPhysicalPathMock.mockReset()
    getPhysicalPathMock.mockImplementation(async () => '/tmp/sample.txt')
  })

  it.each([
    ['.pdf', 'pdf'],
    ['.csv', 'csv'],
    ['.docx', 'docx'],
    ['.json', 'json'],
    ['.md', 'markdown']
  ])('maps %s files to the %s reader', async (ext, expectedReader) => {
    const item = createFileItem(ext)
    getPhysicalPathMock.mockResolvedValueOnce(`/resolved/sample${ext}`)
    const docs = await loadKnowledgeItemDocuments(item)

    expect(getPhysicalPathMock).toHaveBeenCalledWith(FILE_ENTRY_ID)
    expect(readerSpies[expectedReader as keyof typeof readerSpies]).toHaveBeenCalledWith(`/resolved/sample${ext}`)
    expect(docs[0]).toMatchObject({
      metadata: {
        source: `/tmp/sample${ext}`
      }
    })
  })

  it('falls back to TextFileReader for unmatched file extensions', async () => {
    const item = createFileItem('.log')
    getPhysicalPathMock.mockResolvedValueOnce('/resolved/sample.log')
    const docs = await loadKnowledgeItemDocuments(item)

    expect(getPhysicalPathMock).toHaveBeenCalledWith(FILE_ENTRY_ID)
    expect(readerSpies.text).toHaveBeenCalledWith('/resolved/sample.log')
    expect(docs[0]).toMatchObject({
      metadata: {
        source: '/tmp/sample.log'
      }
    })
  })

  it('can read a processed artifact file entry while preserving source metadata', async () => {
    const item = createFileItem('.pdf', '/tmp/source.pdf')
    getPhysicalPathMock.mockResolvedValueOnce('/resolved/processed.md')

    const docs = await loadKnowledgeItemDocuments(item, undefined, { fileEntryId: PROCESSED_FILE_ENTRY_ID })

    expect(getPhysicalPathMock).toHaveBeenCalledWith(PROCESSED_FILE_ENTRY_ID)
    expect(readerSpies.markdown).toHaveBeenCalledWith('/resolved/processed.md')
    expect(docs[0]).toMatchObject({
      metadata: {
        source: '/tmp/source.pdf'
      }
    })
  })

  it('rejects fileEntryId overrides for non-file items', async () => {
    const item = createNoteItem('hello world', 'https://example.com/note')

    await expect(loadKnowledgeItemDocuments(item, undefined, { fileEntryId: PROCESSED_FILE_ENTRY_ID })).rejects.toThrow(
      'fileEntryId override is only supported for file knowledge items: note'
    )

    expect(getPhysicalPathMock).not.toHaveBeenCalled()
  })

  it('uses the drafts export reader for .draftsexport files', async () => {
    const item = createFileItem('.draftsexport')
    getPhysicalPathMock.mockResolvedValueOnce('/resolved/sample.draftsexport')

    const docs = await loadKnowledgeItemDocuments(item)

    expect(getPhysicalPathMock).toHaveBeenCalledWith(FILE_ENTRY_ID)
    expect(customReaderSpies.drafts).toHaveBeenCalledWith('/resolved/sample.draftsexport')
    expect(docs[0]).toMatchObject({
      metadata: {
        source: '/tmp/sample.draftsexport'
      }
    })
  })

  it('uses the epub reader for .epub files', async () => {
    const item = createFileItem('.epub')
    getPhysicalPathMock.mockResolvedValueOnce('/resolved/sample.epub')

    const docs = await loadKnowledgeItemDocuments(item)

    expect(getPhysicalPathMock).toHaveBeenCalledWith(FILE_ENTRY_ID)
    expect(customReaderSpies.epub).toHaveBeenCalledWith('/resolved/sample.epub')
    expect(docs[0]).toMatchObject({
      metadata: {
        source: '/tmp/sample.epub'
      }
    })
  })

  it('throws when a file item cannot resolve a physical path at load time', async () => {
    const resolveError = new Error('File path is required')
    getPhysicalPathMock.mockRejectedValueOnce(resolveError)
    const item = createFileItem('.txt')

    await expect(loadKnowledgeItemDocuments(item)).rejects.toBe(resolveError)
  })

  it('creates a note reader that returns a single Document', async () => {
    const item = createNoteItem('hello world', 'https://example.com/note')
    const docs = await loadKnowledgeItemDocuments(item)

    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({
      text: 'hello world',
      metadata: {
        source: 'https://example.com/note'
      }
    })
  })

  it('fetches markdown from the local knowledge web provider and splits it into documents', async () => {
    fetchMock.mockResolvedValue(new Response('# Example Page\n\nHello knowledge', { status: 200 }))

    const item = createUrlItem()
    const docs = await loadKnowledgeItemDocuments(item)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://r.jina.ai/https://example.com',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        headers: {
          'X-Retain-Images': 'none',
          'X-Return-Format': 'markdown'
        }
      })
    )
    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({
      text: '# Example Page\n\nHello knowledge',
      metadata: {
        source: 'https://example.com'
      }
    })
  })

  it('throws when the knowledge web provider returns empty markdown', async () => {
    fetchMock.mockResolvedValue(new Response('   ', { status: 200 }))

    const item = createUrlItem()

    await expect(loadKnowledgeItemDocuments(item)).rejects.toThrow(
      'Knowledge URL returned empty markdown: https://example.com'
    )
    expect(loggerWarnMock).toHaveBeenCalledWith('Knowledge URL reader received empty markdown', {
      itemId: 'url-1',
      sourceUrl: 'https://example.com'
    })
  })

  it('throws for unsupported directory items', async () => {
    const item = createDirectoryItem()

    await expect(
      loadKnowledgeItemDocuments(item as unknown as Parameters<typeof loadKnowledgeItemDocuments>[0])
    ).rejects.toThrow(`Unsupported knowledge item type: ${item.type}`)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
