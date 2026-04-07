import type { KnowledgeItemOf } from '@shared/data/types/knowledge'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.hoisted(() => vi.fn())
const customReaderSpies = vi.hoisted(() => ({
  drafts: vi.fn(async (item: KnowledgeItemOf<'file'>) => [{ metadata: { reader: 'drafts', itemId: item.id } }]),
  epub: vi.fn(async (item: KnowledgeItemOf<'file'>) => [{ metadata: { reader: 'epub', itemId: item.id } }])
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
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

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
    loadData = (filePath: string) =>
      customReaderSpies.drafts({
        id: 'item-1',
        baseId: 'base-1',
        groupId: null,
        type: 'file',
        status: 'idle',
        error: null,
        createdAt: '2026-04-03T00:00:00.000Z',
        updatedAt: '2026-04-03T00:00:00.000Z',
        data: {
          file: {
            id: 'file-1',
            name: filePath.split('/').pop() || filePath,
            origin_name: filePath.split('/').pop() || filePath,
            path: filePath,
            size: 1,
            ext: '.draftsexport',
            type: 'document',
            created_at: '2026-04-03T00:00:00.000Z',
            count: 1
          }
        }
      } as KnowledgeItemOf<'file'>)
  }
}))

vi.mock('../files/EpubReader', () => ({
  EpubReader: class {
    loadData = (filePath: string) =>
      customReaderSpies.epub({
        id: 'item-1',
        baseId: 'base-1',
        groupId: null,
        type: 'file',
        status: 'idle',
        error: null,
        createdAt: '2026-04-03T00:00:00.000Z',
        updatedAt: '2026-04-03T00:00:00.000Z',
        data: {
          file: {
            id: 'file-1',
            name: filePath.split('/').pop() || filePath,
            origin_name: filePath.split('/').pop() || filePath,
            path: filePath,
            size: 1,
            ext: '.epub',
            type: 'document',
            created_at: '2026-04-03T00:00:00.000Z',
            count: 1
          }
        }
      } as KnowledgeItemOf<'file'>)
  }
}))

const { loadKnowledgeItemDocuments } = await import('../KnowledgeReader')

function createFileItem(ext: string, filePath?: string): KnowledgeItemOf<'file'> {
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
      file: {
        id: 'file-1',
        name: `sample${ext}`,
        origin_name: `sample${ext}`,
        path: filePath ?? `/tmp/sample${ext}`,
        size: 1,
        ext,
        type: 'document',
        created_at: '2026-04-03T00:00:00.000Z',
        count: 1
      }
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
      name: 'example-directory',
      path: '/tmp/example-directory'
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
      url: 'https://example.com',
      name: 'Example'
    }
  }
}

function createSitemapItem(): KnowledgeItemOf<'sitemap'> {
  return {
    id: 'sitemap-1',
    baseId: 'base-1',
    groupId: null,
    type: 'sitemap',
    status: 'idle',
    error: null,
    createdAt: '2026-04-03T00:00:00.000Z',
    updatedAt: '2026-04-03T00:00:00.000Z',
    data: {
      url: 'https://example.com/sitemap.xml',
      name: 'Example Sitemap'
    }
  }
}

describe('loadKnowledgeItemDocuments', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it.each([
    ['.pdf', 'pdf'],
    ['.csv', 'csv'],
    ['.docx', 'docx'],
    ['.json', 'json'],
    ['.md', 'markdown']
  ])('maps %s files to the %s reader', async (ext, expectedReader) => {
    const item = createFileItem(ext)
    const docs = await loadKnowledgeItemDocuments(item)

    expect(docs[0]).toMatchObject({
      metadata: {
        reader: expectedReader,
        filePath: `/tmp/sample${ext}`
      }
    })
  })

  it('falls back to TextFileReader for unmatched file extensions', async () => {
    const item = createFileItem('.log')
    const docs = await loadKnowledgeItemDocuments(item)

    expect(docs[0]).toMatchObject({
      metadata: {
        reader: 'text',
        filePath: '/tmp/sample.log'
      }
    })
  })

  it('uses the drafts export reader for .draftsexport files', async () => {
    const item = createFileItem('.draftsexport')

    const docs = await loadKnowledgeItemDocuments(item)

    expect(customReaderSpies.drafts).toHaveBeenCalled()
    expect(docs[0]).toMatchObject({
      metadata: {
        reader: 'drafts',
        itemId: 'item-1'
      }
    })
  })

  it('uses the epub reader for .epub files', async () => {
    const item = createFileItem('.epub')

    const docs = await loadKnowledgeItemDocuments(item)

    expect(customReaderSpies.epub).toHaveBeenCalled()
    expect(docs[0]).toMatchObject({
      metadata: {
        reader: 'epub',
        itemId: 'item-1'
      }
    })
  })

  it('throws when a file item is missing file.path at load time', async () => {
    const item = createFileItem('.txt', '')

    await expect(loadKnowledgeItemDocuments(item)).rejects.toThrow('Knowledge file file-1 is missing file.path')
  })

  it('creates a note reader that returns a single Document', async () => {
    const item = createNoteItem('hello world', 'https://example.com/note')
    const docs = await loadKnowledgeItemDocuments(item)

    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({
      text: 'hello world',
      metadata: {
        itemId: 'note-1',
        itemType: 'note',
        sourceUrl: 'https://example.com/note'
      }
    })
  })

  it('returns empty documents for directory items', async () => {
    const item = createDirectoryItem()

    await expect(loadKnowledgeItemDocuments(item)).resolves.toEqual([])
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
        itemId: 'url-1',
        itemType: 'url',
        sourceUrl: 'https://example.com',
        name: 'Example'
      }
    })
  })

  it('uses the local knowledge web provider when loading sitemap urls', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === 'https://example.com/sitemap.xml') {
        return new Response(
          [
            '<urlset>',
            '  <url><loc>https://example.com/page-1</loc></url>',
            '  <url><loc>https://example.com/page-2</loc></url>',
            '  <url><loc>https://example.com/page-1</loc></url>',
            '</urlset>'
          ].join(''),
          { status: 200 }
        )
      }

      return new Response('markdown body', { status: 200 })
    })

    const item = createSitemapItem()
    const docs = await loadKnowledgeItemDocuments(item)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/sitemap.xml',
      expect.objectContaining({
        signal: expect.any(AbortSignal)
      })
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'https://r.jina.ai/https://example.com/page-1',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        headers: {
          'X-Retain-Images': 'none',
          'X-Return-Format': 'markdown'
        }
      })
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'https://r.jina.ai/https://example.com/page-2',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        headers: {
          'X-Retain-Images': 'none',
          'X-Return-Format': 'markdown'
        }
      })
    )
    expect(docs).toHaveLength(2)
  })
})
