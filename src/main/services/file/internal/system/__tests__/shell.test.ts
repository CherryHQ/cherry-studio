import type { FileEntry } from '@shared/data/types/file'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import type { FilePath } from '@shared/types/file'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const openPathSpy = vi.fn(async () => '')
const showItemInFolderSpy = vi.fn(() => undefined)

vi.mock('electron', () => ({
  shell: {
    openPath: openPathSpy,
    showItemInFolder: showItemInFolderSpy
  }
}))

const { assertSafeForDefaultOpen } = await import('../openGuard')
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

  it.each([
    ['trailing space', '/tmp/report.exe '],
    ['trailing dot', '/tmp/payload.exe.']
  ])('default-open guard normalizes fallback extension with %s', (_label, physicalPath) => {
    const entry = { ext: null } as FileEntry

    try {
      assertSafeForDefaultOpen(entry, physicalPath as FilePath)
      throw new Error('expected unsafe default-open to be blocked')
    } catch (error) {
      expect(error).toMatchObject({ code: fileErrorCodes.OPEN_BLOCKED_UNSAFE_TYPE })
    }
  })

  it('showInFolder delegates to shell.showItemInFolder', async () => {
    await showInFolder('/some/file.pdf' as FilePath)
    expect(showItemInFolderSpy).toHaveBeenCalledWith('/some/file.pdf')
  })
})
