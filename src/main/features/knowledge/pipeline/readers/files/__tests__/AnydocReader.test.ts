import { Document, FileReader, type Metadata } from '@vectorstores/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AnydocReader as AnydocReaderClass } from '../AnydocReader'

const { loggerErrorMock, loggerWarnMock, toMarkdownBytesMock, fallbackLoadMock } = vi.hoisted(() => ({
  loggerErrorMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  toMarkdownBytesMock: vi.fn(),
  fallbackLoadMock: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: loggerErrorMock,
      warn: loggerWarnMock
    })
  }
}))

class FallbackReader extends FileReader<Document<Metadata>> {
  async loadDataAsContent(fileContent: Uint8Array, filename?: string): Promise<Document<Metadata>[]> {
    return await fallbackLoadMock(fileContent, filename)
  }
}

let AnydocReader: typeof AnydocReaderClass

const createReader = (fallbackOnEmpty = false) => new AnydocReader(() => new FallbackReader(), fallbackOnEmpty)

describe('AnydocReader', () => {
  beforeEach(async () => {
    vi.resetAllMocks()
    vi.resetModules()
    vi.doMock('@firecrawl/anydoc', () => ({ toMarkdownBytes: toMarkdownBytesMock }))
    ;({ AnydocReader } = await import('../AnydocReader'))
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

  it('uses the legacy EPUB reader when conversion yields blank markdown', async () => {
    toMarkdownBytesMock.mockResolvedValue('   \n  ')
    fallbackLoadMock.mockResolvedValue([new Document({ text: 'legacy chapter' })])

    const content = new Uint8Array([1, 2, 3])
    const docs = await createReader(true).loadDataAsContent(content, 'book.epub')

    expect(docs[0]?.text).toBe('legacy chapter')
    expect(fallbackLoadMock).toHaveBeenCalledWith(content, 'book.epub')
    expect(loggerWarnMock).toHaveBeenCalledWith(
      'anydoc conversion produced no text, falling back to the legacy reader',
      { filename: 'book.epub' }
    )
  })

  it('falls back to the legacy reader when document conversion fails', async () => {
    const failure = new Error('Unsupported document')
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
    expect(loggerErrorMock).not.toHaveBeenCalled()
  })

  it('logs a module load failure once and falls back for every document', async () => {
    const failure = new Error('Failed to load native binding')
    vi.resetModules()
    vi.doMock('@firecrawl/anydoc', () => {
      throw failure
    })
    ;({ AnydocReader } = await import('../AnydocReader'))
    fallbackLoadMock.mockResolvedValue([new Document({ text: 'legacy text' })])

    const content = new Uint8Array([1, 2, 3])
    await createReader().loadDataAsContent(content, 'first.doc')
    await createReader().loadDataAsContent(content, 'second.doc')
    await expect(new AnydocReader().loadDataAsContent(content, 'new.ppt')).rejects.toMatchObject({ cause: failure })
    const fallbackFailure = new Error('Legacy reader also failed')
    fallbackLoadMock.mockRejectedValue(fallbackFailure)
    await expect(createReader().loadDataAsContent(content, 'broken.doc')).rejects.toBe(fallbackFailure)

    expect(fallbackLoadMock).toHaveBeenNthCalledWith(1, content, 'first.doc')
    expect(fallbackLoadMock).toHaveBeenNthCalledWith(2, content, 'second.doc')
    expect(fallbackLoadMock).toHaveBeenNthCalledWith(3, content, 'broken.doc')
    expect(loggerErrorMock).toHaveBeenCalledOnce()
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'Failed to load the anydoc native module',
      expect.objectContaining({ cause: failure })
    )
    expect(loggerWarnMock).not.toHaveBeenCalled()
  })

  it('propagates conversion failure when no usable fallback exists', async () => {
    const failure = new Error('Unsupported document')
    toMarkdownBytesMock.mockRejectedValue(failure)

    await expect(new AnydocReader().loadDataAsContent(new Uint8Array([1, 2, 3]), 'legacy.ppt')).rejects.toBe(failure)
    expect(loggerWarnMock).toHaveBeenCalledWith('anydoc conversion failed', failure, { filename: 'legacy.ppt' })
  })

  it('rejects blank conversion output when no usable fallback exists', async () => {
    toMarkdownBytesMock.mockResolvedValue('  \n ')

    await expect(new AnydocReader().loadDataAsContent(new Uint8Array([1, 2, 3]), 'empty.ppt')).rejects.toThrow(
      'anydoc conversion produced no text'
    )
    expect(loggerWarnMock).toHaveBeenCalledWith(
      'anydoc conversion failed',
      expect.objectContaining({ message: 'anydoc conversion produced no text' }),
      { filename: 'empty.ppt' }
    )
  })

  it('propagates the fallback error without replacing it', async () => {
    const conversionFailure = new Error('Unsupported document')
    const fallbackFailure = new Error('Legacy reader also failed')
    toMarkdownBytesMock.mockRejectedValue(conversionFailure)
    fallbackLoadMock.mockRejectedValue(fallbackFailure)

    await expect(createReader().loadDataAsContent(new Uint8Array([1, 2, 3]), 'broken.epub')).rejects.toBe(
      fallbackFailure
    )
  })
})
