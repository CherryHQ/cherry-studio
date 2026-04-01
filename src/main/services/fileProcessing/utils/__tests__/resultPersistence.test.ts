import fs from 'node:fs/promises'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { persistMarkdownResult, persistZipResult } from '../resultPersistence'

const { entriesMock, extractMock, closeMock, pathExistsMock } = vi.hoisted(() => ({
  entriesMock: vi.fn(),
  extractMock: vi.fn(),
  closeMock: vi.fn(),
  pathExistsMock: vi.fn()
}))

vi.mock('node-stream-zip', () => ({
  default: {
    async: vi.fn(() => ({
      entries: entriesMock,
      extract: extractMock,
      close: closeMock
    }))
  }
}))

vi.mock('@main/utils/file', () => ({
  pathExists: pathExistsMock
}))

describe('fileProcessing result persistence utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    closeMock.mockResolvedValue(undefined)
    extractMock.mockResolvedValue(undefined)
    pathExistsMock.mockResolvedValue(false)
  })

  it('persists zip results via a temp directory and atomically swaps the final result directory', async () => {
    const lockCloseMock = vi.fn()

    const mkdirSpy = vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined)
    const mkdtempSpy = vi.spyOn(fs, 'mkdtemp').mockResolvedValue('/tmp/file-processing/task-1.tmp-abc')
    const openSpy = vi.spyOn(fs, 'open').mockResolvedValue({ close: lockCloseMock } as never)
    const renameSpy = vi.spyOn(fs, 'rename').mockResolvedValue(undefined)
    const rmSpy = vi.spyOn(fs, 'rm').mockResolvedValue(undefined)
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
    const markdownPath = await persistZipResult({
      zipFilePath: '/tmp/download/result.zip',
      resultsDir: '/tmp/file-processing/task-1'
    })

    expect(markdownPath).toBe('/tmp/file-processing/task-1/output.md')
    expect(mkdirSpy).toHaveBeenCalledWith('/tmp/file-processing', { recursive: true })
    expect(mkdtempSpy).toHaveBeenCalledWith('/tmp/file-processing/task-1.tmp-')
    expect(openSpy).toHaveBeenCalledWith('/tmp/file-processing/task-1.lock', 'wx')
    expect(lockCloseMock).toHaveBeenCalled()
    expect(pathExistsMock).toHaveBeenCalledWith('/tmp/file-processing/task-1')
    expect(extractMock).toHaveBeenCalledWith('bundle/output.md', '/tmp/file-processing/task-1.tmp-abc/output.md')
    expect(extractMock).toHaveBeenCalledWith(
      'bundle/images/page-1.png',
      '/tmp/file-processing/task-1.tmp-abc/images/page-1.png'
    )
    expect(renameSpy).toHaveBeenCalledWith('/tmp/file-processing/task-1.tmp-abc', '/tmp/file-processing/task-1')
    expect(rmSpy).toHaveBeenCalledWith('/tmp/file-processing/task-1.lock', { force: true })
    expect(closeMock).toHaveBeenCalled()
  })

  it('persists plain markdown through the same atomic directory swap flow', async () => {
    const lockCloseMock = vi.fn()

    vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined)
    vi.spyOn(fs, 'mkdtemp').mockResolvedValue('/tmp/file-processing/task-2.tmp-abc')
    vi.spyOn(fs, 'open').mockResolvedValue({ close: lockCloseMock } as never)
    const writeFileSpy = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined)
    const renameSpy = vi.spyOn(fs, 'rename').mockResolvedValue(undefined)
    vi.spyOn(fs, 'rm').mockResolvedValue(undefined)

    const markdownPath = await persistMarkdownResult({
      resultsDir: '/tmp/file-processing/task-2',
      markdownContent: '# output'
    })

    expect(markdownPath).toBe('/tmp/file-processing/task-2/output.md')
    expect(writeFileSpy).toHaveBeenCalledWith('/tmp/file-processing/task-2.tmp-abc/output.md', '# output', 'utf-8')
    expect(renameSpy).toHaveBeenCalledWith('/tmp/file-processing/task-2.tmp-abc', '/tmp/file-processing/task-2')
  })

  it('rejects zip entries that escape the task directory', async () => {
    vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined)
    const rmSpy = vi.spyOn(fs, 'rm').mockResolvedValue(undefined)
    entriesMock.mockResolvedValueOnce({
      '../escape.md': {
        name: '../escape.md',
        isDirectory: false
      }
    })

    await expect(
      persistZipResult({
        zipFilePath: '/tmp/download/result.zip',
        resultsDir: '/tmp/file-processing/task-2'
      })
    ).rejects.toThrow('Unsafe zip entry path')

    expect(rmSpy).toHaveBeenCalledWith('/tmp/file-processing/task-2.tmp-abc', { recursive: true, force: true })
  })

  it('treats a false pathExists probe as a simple cache miss while persisting markdown', async () => {
    vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined)
    vi.spyOn(fs, 'mkdtemp').mockResolvedValue('/tmp/file-processing/task-3.tmp-abc')
    vi.spyOn(fs, 'open').mockResolvedValue({ close: vi.fn() } as never)
    vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined)
    const renameSpy = vi.spyOn(fs, 'rename').mockResolvedValue(undefined)
    vi.spyOn(fs, 'rm').mockResolvedValue(undefined)

    await expect(
      persistMarkdownResult({
        resultsDir: '/tmp/file-processing/task-3',
        markdownContent: '# output'
      })
    ).resolves.toBe('/tmp/file-processing/task-3/output.md')

    expect(pathExistsMock).toHaveBeenCalledWith('/tmp/file-processing/task-3')
    expect(renameSpy).toHaveBeenCalledWith('/tmp/file-processing/task-3.tmp-abc', '/tmp/file-processing/task-3')
  })
})
