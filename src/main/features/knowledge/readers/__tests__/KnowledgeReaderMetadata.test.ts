import type * as FsUtils from '@main/utils/file/fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { loadDataMock, readFileMock } = vi.hoisted(() => ({
  loadDataMock: vi.fn(),
  readFileMock: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

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

// The URL reader reads its snapshot file verbatim (minus the cherry
// frontmatter) instead of going through a vectorstores reader.
vi.mock('@main/utils/file/fs', async (importOriginal) => ({
  ...(await importOriginal<typeof FsUtils>()),
  read: readFileMock
}))

vi.mock('../files/DraftsExportReader', () => ({ DraftsExportReader: class MockDraftsExportReader {} }))
vi.mock('../files/EpubReader', () => ({ EpubReader: class MockEpubReader {} }))

const { loadFileDocuments } = await import('../KnowledgeFileReader')
const { loadSnapshotDocuments } = await import('../KnowledgeSnapshotReader')

describe('knowledge reader metadata', () => {
  beforeEach(() => {
    loadDataMock.mockClear()
    readFileMock.mockClear()
  })

  it('normalizes file source metadata', async () => {
    const documents = await loadFileDocuments({
      id: 'file-item-1',
      baseId: 'kb-1',
      groupId: null,
      type: 'file',
      data: {
        source: '/tmp/original.txt',
        relativePath: 'original.txt'
      },
      status: 'idle',
      error: null,
      createdAt: '2026-04-08T00:00:00.000Z',
      updatedAt: '2026-04-08T00:00:00.000Z'
    })

    expect(loadDataMock).toHaveBeenCalledWith('/mock/feature.knowledgebase.data/kb-1/raw/original.txt')
    expect(documents[0]?.metadata).toEqual({
      source: '/tmp/original.txt'
    })
  })

  it('reads the url snapshot verbatim minus its cherry frontmatter and tags the source', async () => {
    readFileMock.mockResolvedValueOnce(
      '---\ncherry:\n  type: url-snapshot\n  source: "https://example.com"\n---\n# Page\n\nbody [kept](https://example.com/link)\n'
    )

    const documents = await loadSnapshotDocuments(
      {
        id: 'url-item-1',
        baseId: 'kb-1',
        groupId: null,
        type: 'url',
        data: { source: 'https://example.com', url: 'https://example.com', relativePath: 'example.md' },
        status: 'idle',
        error: null,
        createdAt: '2026-04-08T00:00:00.000Z',
        updatedAt: '2026-04-08T00:00:00.000Z'
      },
      'URL'
    )

    expect(readFileMock).toHaveBeenCalledWith('/mock/feature.knowledgebase.data/kb-1/raw/example.md')
    expect(documents).toHaveLength(1)
    expect(documents[0]?.text).toBe('# Page\n\nbody [kept](https://example.com/link)\n')
    expect(documents[0]?.metadata).toEqual({
      source: 'https://example.com'
    })
  })

  it('rejects a url item with no captured snapshot', async () => {
    await expect(
      loadSnapshotDocuments(
        {
          id: 'url-item-1',
          baseId: 'kb-1',
          groupId: null,
          type: 'url',
          data: { source: 'https://example.com', url: 'https://example.com' },
          status: 'idle',
          error: null,
          createdAt: '2026-04-08T00:00:00.000Z',
          updatedAt: '2026-04-08T00:00:00.000Z'
        },
        'URL'
      )
    ).rejects.toThrow('has no captured snapshot')
  })

  it('reads the note snapshot verbatim and tags the source', async () => {
    readFileMock.mockResolvedValueOnce('# Note title\n\nbody')

    const documents = await loadSnapshotDocuments(
      {
        id: 'note-item-1',
        baseId: 'kb-1',
        groupId: null,
        type: 'note',
        data: { source: 'My note', content: '# Note title\n\nbody', relativePath: 'My note.md' },
        status: 'idle',
        error: null,
        createdAt: '2026-04-08T00:00:00.000Z',
        updatedAt: '2026-04-08T00:00:00.000Z'
      },
      'note'
    )

    expect(readFileMock).toHaveBeenCalledWith('/mock/feature.knowledgebase.data/kb-1/raw/My note.md')
    expect(documents).toHaveLength(1)
    expect(documents[0]?.text).toBe('# Note title\n\nbody')
    expect(documents[0]?.metadata).toEqual({
      source: 'My note'
    })
  })

  it('rejects a note item with no captured snapshot', async () => {
    await expect(
      loadSnapshotDocuments(
        {
          id: 'note-item-1',
          baseId: 'kb-1',
          groupId: null,
          type: 'note',
          data: { source: 'My note', content: 'body' },
          status: 'idle',
          error: null,
          createdAt: '2026-04-08T00:00:00.000Z',
          updatedAt: '2026-04-08T00:00:00.000Z'
        },
        'note'
      )
    ).rejects.toThrow('has no captured snapshot')
  })
})
