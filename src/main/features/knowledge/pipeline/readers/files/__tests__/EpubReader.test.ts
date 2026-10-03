import { beforeEach, describe, expect, it, vi } from 'vitest'

const { loggerErrorMock, parseMock, getChapterMock } = vi.hoisted(() => ({
  loggerErrorMock: vi.fn(),
  parseMock: vi.fn(),
  getChapterMock: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: loggerErrorMock
    })
  }
}))

vi.mock('epub', () => ({
  default: class MockEpub {
    flow = [
      { id: 'chapter-1', title: 'Chapter 1' },
      { id: 'chapter-2', title: 'Chapter 2' }
    ]

    metadata = {
      title: 'Test EPUB',
      creator: 'Author',
      language: 'en'
    }

    constructor(buffer: Buffer) {
      void buffer
    }

    async parse() {
      return await parseMock()
    }

    async getChapter(id: string) {
      return await getChapterMock(id)
    }
  }
}))

const { EpubReader } = await import('../EpubReader')

describe('EpubReader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    parseMock.mockResolvedValue(undefined)
  })

  it('returns chapter documents when all chapters are readable', async () => {
    getChapterMock.mockImplementation(async (id: string) => `<p>${id} content</p>`)

    const reader = new EpubReader()
    const docs = await reader.loadDataAsContent(new Uint8Array([1, 2, 3]), 'book.epub')

    expect(docs).toHaveLength(2)
    expect(docs[0]?.text).toBe('chapter-1 content')
    expect(docs[0]?.metadata).toEqual({})
    expect(loggerErrorMock).not.toHaveBeenCalled()
  })

  it('drops the contents of style and script tags', async () => {
    getChapterMock.mockImplementation(
      async (id: string) =>
        `<head><style>body{font-family:serif;color:#222}</style></head>` +
        `<body><script>var a = 1</script><p>${id} content</p></body>`
    )

    const reader = new EpubReader()
    const docs = await reader.loadDataAsContent(new Uint8Array([1, 2, 3]), 'book.epub')

    expect(docs[0]?.text).toBe('chapter-1 content')
    expect(docs[0]?.text).not.toContain('font-family')
    expect(docs[0]?.text).not.toContain('var a')
  })

  it('keeps markup the chapter escaped on purpose', async () => {
    // parseContent decodes entities before it strips when it is called without
    // the reader's own options, so `&lt;div&gt;` becomes a tag and is deleted.
    getChapterMock.mockImplementation(async () => '<p>To open a block write &lt;div&gt; first.</p>')

    const reader = new EpubReader()
    const docs = await reader.loadDataAsContent(new Uint8Array([1, 2, 3]), 'book.epub')

    expect(docs[0]?.text).toContain('div')
    expect(docs[0]?.text).toBe('To open a block write &lt;div&gt; first.')
  })

  it('skips a chapter that carries no text of its own', async () => {
    getChapterMock.mockImplementation(async (id: string) =>
      id === 'chapter-1' ? '<style>p{margin:0}</style>' : '<p>chapter-2 content</p>'
    )

    const reader = new EpubReader()
    const docs = await reader.loadDataAsContent(new Uint8Array([1, 2, 3]), 'book.epub')

    expect(docs).toHaveLength(1)
    expect(docs[0]?.text).toBe('chapter-2 content')
  })

  it('rejects the epub when any chapter fails instead of silently returning partial content', async () => {
    const chapterError = new Error('chapter read failed')
    getChapterMock.mockImplementation(async (id: string) => {
      if (id === 'chapter-2') {
        throw chapterError
      }

      return '<p>chapter-1 content</p>'
    })

    const reader = new EpubReader()

    await expect(reader.loadDataAsContent(new Uint8Array([1, 2, 3]), 'book.epub')).rejects.toThrow(
      'Failed to read epub chapters: chapter-2'
    )
    expect(loggerErrorMock).toHaveBeenCalledWith('Failed to read epub chapter', chapterError, {
      filename: 'book.epub',
      chapterId: 'chapter-2'
    })
  })
})
