import type * as FsUtils from '@main/utils/file/fs'
import type { KnowledgeItemOf } from '@shared/data/types/knowledge'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.hoisted(() => vi.fn())
const loggerWarnMock = vi.hoisted(() => vi.fn())
const customReaderSpies = vi.hoisted(() => ({
  drafts: vi.fn(async (filePath: string) => [{ metadata: { reader: 'drafts', filePath } }]),
  epub: vi.fn(async (filePath: string) => [{ metadata: { reader: 'epub', filePath } }])
}))
const readerSpies = vi.hoisted(() => ({
  csv: vi.fn(async (filePath: string) => [{ metadata: { reader: 'csv', filePath } }]),
  docx: vi.fn(async (filePath: string) => [{ metadata: { reader: 'docx', filePath } }]),
  html: vi.fn(async (filePath: string) => [{ metadata: { reader: 'html', filePath } }]),
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
  return mockApplicationFactory()
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

vi.mock('@vectorstores/readers/html', () => ({
  HTMLReader: class {
    loadData = readerSpies.html
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

// The URL reader reads its snapshot verbatim via fs, not a vectorstores reader.
const readFileMock = vi.hoisted(() => vi.fn())
vi.mock('@main/utils/file/fs', async (importOriginal) => ({
  ...(await importOriginal<typeof FsUtils>()),
  read: readFileMock
}))

const { loadKnowledgeItemDocuments } = await import('../KnowledgeReader')

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
      relativePath: `sample${ext}`
    }
  }
}

function createNoteItem(content: string, relativePath = 'note-1.md'): KnowledgeItemOf<'note'> {
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
      source: 'My note',
      content,
      relativePath
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
      url: 'https://example.com',
      relativePath: 'example-page.md'
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
  })

  it.each([
    ['.pdf', 'pdf'],
    ['.csv', 'csv'],
    ['.docx', 'docx'],
    ['.html', 'html'],
    ['.htm', 'html'],
    ['.json', 'json'],
    ['.markdown', 'markdown'],
    ['.md', 'markdown'],
    ['.mdx', 'markdown']
  ])('maps %s files to the %s reader', async (ext, expectedReader) => {
    const item = createFileItem(ext)
    const docs = await loadKnowledgeItemDocuments(item)

    expect(readerSpies[expectedReader as keyof typeof readerSpies]).toHaveBeenCalledWith(
      `/mock/feature.knowledgebase.data/base-1/raw/sample${ext}`
    )
    expect(docs[0]).toMatchObject({
      metadata: {
        source: `/tmp/sample${ext}`
      }
    })
  })

  it('falls back to TextFileReader for unmatched file extensions', async () => {
    const item = createFileItem('.log')
    const docs = await loadKnowledgeItemDocuments(item)

    expect(readerSpies.text).toHaveBeenCalledWith('/mock/feature.knowledgebase.data/base-1/raw/sample.log')
    expect(docs[0]).toMatchObject({
      metadata: {
        source: '/tmp/sample.log'
      }
    })
  })

  it('can read a processed artifact path while preserving source metadata', async () => {
    const item = {
      ...createFileItem('.pdf', '/tmp/source.pdf'),
      data: {
        source: '/tmp/source.pdf',
        relativePath: 'source.pdf',
        indexedRelativePath: 'source.md'
      }
    }

    const docs = await loadKnowledgeItemDocuments(item)

    expect(readerSpies.markdown).toHaveBeenCalledWith('/mock/feature.knowledgebase.data/base-1/raw/source.md')
    expect(docs[0]).toMatchObject({
      metadata: {
        source: '/tmp/source.pdf'
      }
    })
  })

  it('uses the drafts export reader for .draftsexport files', async () => {
    const item = createFileItem('.draftsexport')

    const docs = await loadKnowledgeItemDocuments(item)

    expect(customReaderSpies.drafts).toHaveBeenCalledWith(
      '/mock/feature.knowledgebase.data/base-1/raw/sample.draftsexport'
    )
    expect(docs[0]).toMatchObject({
      metadata: {
        source: '/tmp/sample.draftsexport'
      }
    })
  })

  it('uses the epub reader for .epub files', async () => {
    const item = createFileItem('.epub')

    const docs = await loadKnowledgeItemDocuments(item)

    expect(customReaderSpies.epub).toHaveBeenCalledWith('/mock/feature.knowledgebase.data/base-1/raw/sample.epub')
    expect(docs[0]).toMatchObject({
      metadata: {
        source: '/tmp/sample.epub'
      }
    })
  })

  it('creates a note reader that returns a single Document from its snapshot', async () => {
    readFileMock.mockResolvedValueOnce('hello world')
    const item = createNoteItem('hello world', 'my-note.md')
    const docs = await loadKnowledgeItemDocuments(item)

    expect(readFileMock).toHaveBeenCalledWith('/mock/feature.knowledgebase.data/base-1/raw/my-note.md')
    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({
      text: 'hello world',
      metadata: {
        source: 'My note'
      }
    })
  })

  it('reads a url item verbatim from its captured snapshot, minus the cherry frontmatter', async () => {
    readFileMock.mockResolvedValueOnce(
      '---\ncherry:\n  type: url-snapshot\n  source: "https://example.com"\n---\n# Page\n\nbody\n'
    )
    const item = createUrlItem()
    const docs = await loadKnowledgeItemDocuments(item)

    // The reader never fetches; the indexing job's ensure-snapshot step does.
    expect(fetchMock).not.toHaveBeenCalled()
    expect(readFileMock).toHaveBeenCalledWith('/mock/feature.knowledgebase.data/base-1/raw/example-page.md')
    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({
      text: '# Page\n\nbody\n',
      metadata: {
        source: 'https://example.com'
      }
    })
  })

  it('throws when a url item has no captured snapshot', async () => {
    const item = { ...createUrlItem(), data: { source: 'https://example.com', url: 'https://example.com' } }

    await expect(loadKnowledgeItemDocuments(item)).rejects.toThrow('has no captured snapshot to read')
  })

  it('throws for unsupported directory items', async () => {
    const item = createDirectoryItem()

    await expect(
      loadKnowledgeItemDocuments(item as unknown as Parameters<typeof loadKnowledgeItemDocuments>[0])
    ).rejects.toThrow(`Unsupported knowledge item type: ${item.type}`)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
