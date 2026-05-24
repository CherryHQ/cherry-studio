import type { FilePath } from '@shared/file/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const openPathSpy = vi.fn(async () => '')
const showItemInFolderSpy = vi.fn(() => undefined)

vi.mock('electron', () => ({
  shell: {
    openPath: openPathSpy,
    showItemInFolder: showItemInFolderSpy
  }
}))

const { open, showInFolder } = await import('../shell')

describe('internal/system/shell', () => {
  beforeEach(() => {
    openPathSpy.mockReset()
    openPathSpy.mockResolvedValue('')
    showItemInFolderSpy.mockReset()
  })

  it('open delegates to shell.openPath', async () => {
    await open('/some/file.pdf' as FilePath)
    expect(openPathSpy).toHaveBeenCalledWith('/some/file.pdf')
  })

  it('open throws when shell.openPath returns a non-empty error string', async () => {
    openPathSpy.mockResolvedValueOnce('No application is associated with this file.')
    await expect(open('/x' as FilePath)).rejects.toThrow(/No application/)
  })

  it('showInFolder delegates to shell.showItemInFolder', async () => {
    await showInFolder('/some/file.pdf' as FilePath)
    expect(showItemInFolderSpy).toHaveBeenCalledWith('/some/file.pdf')
  })
})
