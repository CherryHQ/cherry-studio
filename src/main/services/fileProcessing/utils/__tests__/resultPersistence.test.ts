import fs from 'node:fs/promises'

import AdmZip from 'adm-zip'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { persistZipResult } from '../resultPersistence'

describe('fileProcessing result persistence utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('persists markdown to a fixed output path and keeps related assets addressable from it', async () => {
    const zip = new AdmZip()
    zip.addFile('bundle/output.md', Buffer.from('![](images/page-1.png)'))
    zip.addFile('bundle/images/page-1.png', Buffer.from('png-data'))

    const mkdirSpy = vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined)
    const writeFileSpy = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined)

    const markdownPath = await persistZipResult({
      zipBuffer: zip.toBuffer(),
      resultsDir: '/tmp/file-processing/task-1',
      isMarkdownEntry: (entryName) => entryName.toLowerCase().endsWith('.md')
    })

    expect(markdownPath).toBe('/tmp/file-processing/task-1/output.md')
    expect(mkdirSpy).toHaveBeenCalledWith('/tmp/file-processing/task-1', { recursive: true })
    expect(writeFileSpy).toHaveBeenCalledWith('/tmp/file-processing/task-1/output.md', expect.any(Buffer))
    expect(writeFileSpy).toHaveBeenCalledWith('/tmp/file-processing/task-1/images/page-1.png', expect.any(Buffer))
  })

  it('rejects zip entries that escape the task directory', async () => {
    const zip = new AdmZip()
    zip.addFile('../escape.md', Buffer.from('oops'))

    vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined)
    vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined)
    const rmSpy = vi.spyOn(fs, 'rm').mockResolvedValue(undefined)

    await expect(
      persistZipResult({
        zipBuffer: zip.toBuffer(),
        resultsDir: '/tmp/file-processing/task-2',
        isMarkdownEntry: (entryName) => entryName.toLowerCase().endsWith('.md')
      })
    ).rejects.toThrow('Unsafe zip entry path')

    expect(rmSpy).not.toHaveBeenCalled()
  })
})
