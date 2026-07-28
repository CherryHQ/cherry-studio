import fs from 'node:fs/promises'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { entriesMock, entryDataMock, closeMock, createWriteStreamMock, pipelineMock } = vi.hoisted(() => ({
  entriesMock: vi.fn(),
  entryDataMock: vi.fn(),
  closeMock: vi.fn(),
  createWriteStreamMock: vi.fn(),
  pipelineMock: vi.fn()
}))

vi.mock('node:fs', () => ({
  createWriteStream: createWriteStreamMock
}))

vi.mock('node:stream/promises', () => ({
  pipeline: pipelineMock
}))

vi.mock('node-stream-zip', () => ({
  default: {
    async: vi.fn(() => ({
      entries: entriesMock,
      entryData: entryDataMock,
      close: closeMock
    }))
  }
}))

const { readMarkdownFromResponseZip, readMarkdownFromZipFile } = await import('../resultPersistence')

describe('fileProcessing result persistence utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    closeMock.mockResolvedValue(undefined)
    entryDataMock.mockResolvedValue(Buffer.from('# output'))
    createWriteStreamMock.mockReturnValue({ write: vi.fn(), end: vi.fn() })
    pipelineMock.mockResolvedValue(undefined)
  })

  it('reads the first markdown file from a zip without extracting attachments', async () => {
    entriesMock.mockResolvedValueOnce({
      'bundle/output.md': {
        name: 'bundle/output.md',
        isDirectory: false
      },
      'bundle/images/page-1.png': {
        name: 'bundle/images/page-1.png',
        isDirectory: false
      }
    })

    await expect(readMarkdownFromZipFile('/tmp/download/result.zip')).resolves.toEqual(
      new Uint8Array(Buffer.from('# output'))
    )

    expect(entryDataMock).toHaveBeenCalledWith({
      name: 'bundle/output.md',
      isDirectory: false
    })
    expect(closeMock).toHaveBeenCalled()
  })

  it.each([
    ['relative parent escape', '../escape.md'],
    ['POSIX absolute path', '/tmp/output.md'],
    ['Windows drive-letter path', 'C:\\temp\\output.md'],
    ['backslash separator', 'bundle\\output.md']
  ])('rejects zip entries that escape the archive root via %s', async (_name, entryName) => {
    entriesMock.mockResolvedValueOnce({
      [entryName]: {
        name: entryName,
        isDirectory: false
      }
    })

    await expect(readMarkdownFromZipFile('/tmp/download/result.zip')).rejects.toThrow('Unsafe zip entry path')
    expect(entryDataMock).not.toHaveBeenCalled()
    expect(closeMock).toHaveBeenCalled()
  })

  it('skips unsafe non-markdown entries when reading markdown data', async () => {
    entriesMock.mockResolvedValueOnce({
      'bundle/output.md': {
        name: 'bundle/output.md',
        isDirectory: false
      },
      '../escape.png': {
        name: '../escape.png',
        isDirectory: false
      }
    })

    await expect(readMarkdownFromZipFile('/tmp/download/result.zip')).resolves.toEqual(
      new Uint8Array(Buffer.from('# output'))
    )
    expect(entryDataMock).toHaveBeenCalledWith({
      name: 'bundle/output.md',
      isDirectory: false
    })
    expect(closeMock).toHaveBeenCalled()
  })

  it('rejects zips without a markdown file', async () => {
    entriesMock.mockResolvedValueOnce({
      'bundle/page-1.png': {
        name: 'bundle/page-1.png',
        isDirectory: false
      }
    })

    await expect(readMarkdownFromZipFile('/tmp/download/result.zip')).rejects.toThrow(
      'Result zip does not contain a markdown file'
    )
    expect(entryDataMock).not.toHaveBeenCalled()
    expect(closeMock).toHaveBeenCalled()
  })

  it('downloads a response zip to temp storage and reads its markdown entry', async () => {
    const mkdirSpy = vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined)
    const mkdtempSpy = vi.spyOn(fs, 'mkdtemp').mockResolvedValue('/tmp/file-processing/file-processing-result-abc')
    const rmSpy = vi.spyOn(fs, 'rm').mockResolvedValue(undefined)
    entriesMock.mockResolvedValueOnce({
      'output.md': {
        name: 'output.md',
        isDirectory: false
      }
    })
    const response = new Response('zip-binary')

    await expect(
      readMarkdownFromResponseZip({
        response,
        tempDir: '/tmp/file-processing'
      })
    ).resolves.toEqual(new Uint8Array(Buffer.from('# output')))

    expect(mkdirSpy).toHaveBeenCalledWith('/tmp/file-processing', { recursive: true })
    expect(mkdtempSpy).toHaveBeenCalledWith('/tmp/file-processing/file-processing-result-')
    expect(createWriteStreamMock).toHaveBeenCalledWith('/tmp/file-processing/file-processing-result-abc/result.zip')
    expect(pipelineMock).toHaveBeenCalled()
    expect(rmSpy).toHaveBeenCalledWith('/tmp/file-processing/file-processing-result-abc', {
      recursive: true,
      force: true
    })
  })

  it('rejects response zips without a body', async () => {
    vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined)
    vi.spyOn(fs, 'mkdtemp').mockResolvedValue('/tmp/file-processing/file-processing-result-abc')
    vi.spyOn(fs, 'rm').mockResolvedValue(undefined)
    const response = new Response(null)

    await expect(
      readMarkdownFromResponseZip({
        response,
        tempDir: '/tmp/file-processing'
      })
    ).rejects.toThrow('Result download response body is empty')

    expect(pipelineMock).not.toHaveBeenCalled()
  })
})
