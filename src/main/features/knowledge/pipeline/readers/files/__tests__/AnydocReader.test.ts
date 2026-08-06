import { Document, FileReader, type Metadata } from '@vectorstores/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { loggerWarnMock, toMarkdownBytesMock, fallbackLoadMock } = vi.hoisted(() => ({
  loggerWarnMock: vi.fn(),
  toMarkdownBytesMock: vi.fn(),
  fallbackLoadMock: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      warn: loggerWarnMock
    })
  }
}))

vi.mock('@firecrawl/anydoc', () => ({
  toMarkdownBytes: toMarkdownBytesMock
}))

const { AnydocReader } = await import('../AnydocReader')

class FallbackReader extends FileReader<Document<Metadata>> {
  async loadDataAsContent(fileContent: Uint8Array, filename?: string): Promise<Document<Metadata>[]> {
    return await fallbackLoadMock(fileContent, filename)
  }
}

const createReader = () => new AnydocReader(() => new FallbackReader())

describe('AnydocReader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the converted markdown as a single document', async () => {
    toMarkdownBytesMock.mockResolvedValue('# Title\n\nbody\n')

    const docs = await createReader().loadDataAsContent(new Uint8Array([1, 2, 3]), 'report.docx')

    expect(docs).toHaveLength(1)
    expect(docs[0]?.text).toBe('# Title\n\nbody')
    expect(fallbackLoadMock).not.toHaveBeenCalled()
    expect(loggerWarnMock).not.toHaveBeenCalled()
  })

  it('returns no documents when the conversion yields blank markdown', async () => {
    toMarkdownBytesMock.mockResolvedValue('   \n  ')

    const docs = await createReader().loadDataAsContent(new Uint8Array([1, 2, 3]), 'empty.xlsx')

    expect(docs).toEqual([])
    expect(fallbackLoadMock).not.toHaveBeenCalled()
  })

  it('falls back to the legacy reader when anydoc fails, keeping win32-arm64 usable', async () => {
    const failure = new Error('Failed to load native binding')
    toMarkdownBytesMock.mockRejectedValue(failure)
    fallbackLoadMock.mockResolvedValue([new Document({ text: 'legacy text' })])

    const content = new Uint8Array([1, 2, 3])
    const docs = await createReader().loadDataAsContent(content, 'legacy.doc')

    expect(docs).toHaveLength(1)
    expect(docs[0]?.text).toBe('legacy text')
    expect(fallbackLoadMock).toHaveBeenCalledWith(content, 'legacy.doc')
    expect(loggerWarnMock).toHaveBeenCalledWith(
      'anydoc conversion failed, falling back to the legacy reader',
      failure,
      { filename: 'legacy.doc' }
    )
  })
})
