import { dialog, shell } from 'electron'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// `t` pulls in i18n + preference machinery that isn't initialized under test; the
// dialog title it produces is irrelevant to these contracts, so stub it to the key.
vi.mock('@main/i18n', () => ({ t: (key: string) => key }))

import { fileStorage } from '../FileStorage'

const event = {} as Electron.IpcMainInvokeEvent

describe('FileStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('save', () => {
    it('returns null (does not throw) when the save dialog is canceled', async () => {
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true, filePath: undefined } as never)
      await expect(fileStorage.save(event, 'note.md', 'content')).resolves.toBeNull()
    })

    it('returns null when the dialog resolves without a file path', async () => {
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: '' } as never)
      await expect(fileStorage.save(event, 'note.md', 'content')).resolves.toBeNull()
    })
  })

  // resolveHomeRelativeFilePath is module-private; exercise it through showInFolder,
  // which throws with the *resolved* path when the target is missing.
  describe('resolveHomeRelativeFilePath', () => {
    it('expands a ~/-prefixed path against the home directory', async () => {
      await expect(fileStorage.showInFolder(event, '~/Documents/x.txt')).rejects.toThrow(
        path.join('/mock/sys.home', 'Documents', 'x.txt')
      )
    })

    it('leaves a path without the ~/ prefix unchanged', async () => {
      await expect(fileStorage.showInFolder(event, '/no/such/path/x.txt')).rejects.toThrow('/no/such/path/x.txt')
    })
  })

  describe('writeFile', () => {
    let tmpFile: string

    beforeEach(() => {
      tmpFile = path.join(os.tmpdir(), `filestorage-test-${uniqueId()}.txt`)
    })

    afterEach(() => {
      fs.rmSync(tmpFile, { force: true })
    })

    it('writes the given content', async () => {
      await fileStorage.writeFile(event, tmpFile, 'content')
      expect(fs.readFileSync(tmpFile, 'utf-8')).toBe('content')
    })
  })

  describe('deleteExternalFile', () => {
    let tmpFile: string

    beforeEach(() => {
      tmpFile = path.join(os.tmpdir(), `filestorage-delete-test-${uniqueId()}.md`)
      fs.writeFileSync(tmpFile, 'content')
      vi.mocked(shell.trashItem).mockResolvedValue(undefined)
    })

    afterEach(() => {
      fs.rmSync(tmpFile, { force: true })
    })

    it('normalizes the path before passing it to the platform trash API', async () => {
      const portablePath = tmpFile.replace(/\\/g, '/')

      await fileStorage.deleteExternalFile(event, portablePath)

      expect(shell.trashItem).toHaveBeenCalledWith(path.normalize(portablePath))
    })
  })

  describe('deleteExternalDir', () => {
    let tmpDir: string

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filestorage-delete-dir-test-'))
      vi.mocked(shell.trashItem).mockResolvedValue(undefined)
    })

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    it('normalizes the path before passing it to the platform trash API', async () => {
      const portablePath = tmpDir.replace(/\\/g, '/')

      await fileStorage.deleteExternalDir(event, portablePath)

      expect(shell.trashItem).toHaveBeenCalledWith(path.normalize(portablePath))
    })
  })
})

function uniqueId(): string {
  return `${process.pid}-${Math.floor(Math.random() * 1e9)}`
}
