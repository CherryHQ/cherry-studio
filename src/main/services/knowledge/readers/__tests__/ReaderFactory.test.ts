import type { KnowledgeItemOf } from '@shared/data/types/knowledge'
import { describe, expect, it, vi } from 'vitest'

const fetchMock = vi.hoisted(() => vi.fn())
const readerSpies = vi.hoisted(() => ({
  csv: vi.fn(async (filePath: string) => [{ metadata: { reader: 'csv', filePath } }]),
  docx: vi.fn(async (filePath: string) => [{ metadata: { reader: 'docx', filePath } }]),
  json: vi.fn(async (filePath: string) => [{ metadata: { reader: 'json', filePath } }]),
  markdown: vi.fn(async (filePath: string) => [{ metadata: { reader: 'markdown', filePath } }]),
  pdf: vi.fn(async (filePath: string) => [{ metadata: { reader: 'pdf', filePath } }]),
  text: vi.fn(async (filePath: string) => [{ metadata: { reader: 'text', filePath } }])
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

const { ReaderFactory } = await import('../ReaderFactory')

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
      path: '/tmp/example-directory',
      recursive: true
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

describe('ReaderFactory', () => {
  it.each([
    ['.pdf', 'pdf'],
    ['.csv', 'csv'],
    ['.docx', 'docx'],
    ['.json', 'json'],
    ['.md', 'markdown']
  ])('maps %s files to the %s reader', async (ext, expectedReader) => {
    const item = createFileItem(ext)
    const reader = ReaderFactory.create(item)
    const docs = await reader.load(item)

    expect(docs[0]).toMatchObject({
      metadata: {
        reader: expectedReader,
        filePath: `/tmp/sample${ext}`
      }
    })
  })

  it('falls back to TextFileReader for unmatched file extensions', async () => {
    const item = createFileItem('.log')
    const reader = ReaderFactory.create(item)
    const docs = await reader.load(item)

    expect(docs[0]).toMatchObject({
      metadata: {
        reader: 'text',
        filePath: '/tmp/sample.log'
      }
    })
  })

  it('throws when a file item is missing file.path at load time', async () => {
    const item = createFileItem('.txt', '')
    const reader = ReaderFactory.create(item)

    await expect(reader.load(item)).rejects.toThrow('Knowledge file file-1 is missing file.path')
  })

  it('creates a note reader that returns a single Document', async () => {
    const item = createNoteItem('hello world', 'https://example.com/note')
    const reader = ReaderFactory.create(item)
    const docs = await reader.load(item)

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

  it('throws for directory items because they must be expanded before reading', () => {
    const item = createDirectoryItem()

    expect(() => ReaderFactory.create(item)).toThrow('Directory items must be expanded before reading')
  })

  it('fetches markdown from r.jina.ai and splits it into documents', async () => {
    fetchMock.mockResolvedValue(
      new Response('abcdefghij klmnopqrst uvwxyz', {
        status: 200,
        headers: {
          'content-type': 'text/markdown'
        }
      })
    )

    const item = createUrlItem()
    const reader = ReaderFactory.create(item)
    const docs = await reader.load(item)

    expect(fetchMock).toHaveBeenCalledWith(`https://r.jina.ai/${item.data.url}`, {
      headers: {
        'X-Retain-Images': 'none',
        'X-Return-Format': 'markdown'
      }
    })
    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({
      text: 'abcdefghij klmnopqrst uvwxyz',
      metadata: {
        itemId: 'url-1',
        itemType: 'url',
        sourceUrl: 'https://example.com',
        name: 'Example'
      }
    })
  })

  it('returns a sitemap reader that fails explicitly until implemented', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === 'https://example.com/sitemap.xml') {
        return new Response(
          [
            '<sitemapindex>',
            '  <sitemap><loc>https://example.com/sitemap-pages.xml</loc></sitemap>',
            '  <sitemap><loc>https://example.com/sitemap-pages.xml</loc></sitemap>',
            '</sitemapindex>'
          ].join(''),
          { status: 200 }
        )
      }

      if (url === 'https://example.com/sitemap-pages.xml') {
        return new Response(
          [
            '<urlset>',
            '  <url><loc>https://example.com/page-1</loc></url>',
            '  <url><loc>https://example.com/page-2</loc></url>',
            '</urlset>'
          ].join(''),
          { status: 200 }
        )
      }

      return new Response('markdown body', { status: 200 })
    })

    const item = createSitemapItem()
    const reader = ReaderFactory.create(item)
    const docs = await reader.load(item)

    expect(fetchMock).toHaveBeenCalledWith('https://example.com/sitemap.xml')
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/sitemap-pages.xml')
    expect(fetchMock).toHaveBeenCalledWith('https://r.jina.ai/https://example.com/page-1', {
      headers: {
        'X-Retain-Images': 'none',
        'X-Return-Format': 'markdown'
      }
    })
    expect(fetchMock).toHaveBeenCalledWith('https://r.jina.ai/https://example.com/page-2', {
      headers: {
        'X-Retain-Images': 'none',
        'X-Return-Format': 'markdown'
      }
    })
    expect(docs).toHaveLength(2)
  })
})
