import { describe, expect, it, vi } from 'vitest'

const loadDataMock = vi.hoisted(() => vi.fn())

vi.mock('@main/utils/file', () => ({
  getFileExt: (path: string) => path.slice(path.lastIndexOf('.'))
}))

vi.mock('@vectorstores/readers/text', async () => {
  const { Document } = await import('@vectorstores/core')

  return {
    TextFileReader: class MockTextFileReader {
      loadData = loadDataMock.mockResolvedValue([
        new Document({
          text: 'file content',
          metadata: { page: 1 }
        })
      ])
    }
  }
})

vi.mock('@vectorstores/readers/csv', () => ({ CSVReader: class MockCSVReader {} }))
vi.mock('@vectorstores/readers/docx', () => ({ DocxReader: class MockDocxReader {} }))
vi.mock('@vectorstores/readers/json', () => ({ JSONReader: class MockJSONReader {} }))
vi.mock('@vectorstores/readers/markdown', () => ({ MarkdownReader: class MockMarkdownReader {} }))
vi.mock('@vectorstores/readers/pdf', () => ({ PDFReader: class MockPDFReader {} }))

vi.mock('../files/DraftsExportReader', () => ({ DraftsExportReader: class MockDraftsExportReader {} }))
vi.mock('../files/EpubReader', () => ({ EpubReader: class MockEpubReader {} }))

vi.mock('../../utils/url', () => ({
  fetchKnowledgeWebPage: vi.fn().mockResolvedValue('url content')
}))

const { loadFileDocuments } = await import('../KnowledgeFileReader')
const { loadNoteDocuments } = await import('../KnowledgeNoteReader')
const { loadUrlDocuments } = await import('../KnowledgeUrlReader')

describe('knowledge reader metadata', () => {
  it('normalizes file source metadata', async () => {
    const documents = await loadFileDocuments({
      id: 'file-item-1',
      baseId: 'kb-1',
      groupId: null,
      type: 'file',
      data: {
        file: {
          id: 'file-1',
          name: 'stored.txt',
          origin_name: 'Original.txt',
          path: '/tmp/original.txt',
          size: 12,
          ext: 'txt',
          type: 'text',
          created_at: '2026-04-08T00:00:00.000Z',
          count: 1
        }
      },
      status: 'idle',
      error: null,
      createdAt: '2026-04-08T00:00:00.000Z',
      updatedAt: '2026-04-08T00:00:00.000Z'
    })

    expect(documents[0]?.metadata).toEqual({
      source: '/tmp/original.txt',
      name: 'Original.txt',
      extras: { page: 1 }
    })
  })

  it('normalizes url source metadata', async () => {
    const documents = await loadUrlDocuments({
      id: 'url-item-1',
      baseId: 'kb-1',
      groupId: null,
      type: 'url',
      data: { url: 'https://example.com', name: 'Example' },
      status: 'idle',
      error: null,
      createdAt: '2026-04-08T00:00:00.000Z',
      updatedAt: '2026-04-08T00:00:00.000Z'
    })

    expect(documents[0]?.metadata).toEqual({
      source: 'https://example.com',
      name: 'Example'
    })
  })

  it('uses note sourceUrl and first content line as source metadata', async () => {
    const documents = await loadNoteDocuments({
      id: 'note-item-1',
      baseId: 'kb-1',
      groupId: null,
      type: 'note',
      data: { content: '\n  Note title\nbody', sourceUrl: 'https://example.com/note' },
      status: 'idle',
      error: null,
      createdAt: '2026-04-08T00:00:00.000Z',
      updatedAt: '2026-04-08T00:00:00.000Z'
    })

    expect(documents[0]?.metadata).toEqual({
      source: 'https://example.com/note',
      name: 'Note title'
    })
  })

  it('falls back note source metadata to item id', async () => {
    const documents = await loadNoteDocuments({
      id: 'note-item-1',
      baseId: 'kb-1',
      groupId: null,
      type: 'note',
      data: { content: '   ' },
      status: 'idle',
      error: null,
      createdAt: '2026-04-08T00:00:00.000Z',
      updatedAt: '2026-04-08T00:00:00.000Z'
    })

    expect(documents[0]?.metadata).toEqual({
      source: 'note-item-1',
      name: 'note-item-1'
    })
  })
})
