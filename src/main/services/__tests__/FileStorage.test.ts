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

  afterEach(() => {
    vi.restoreAllMocks()
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

  describe('openPath', () => {
    it('opens a file with a safe extension via the system default app', async () => {
      vi.mocked(shell.openPath).mockResolvedValue('')
      await fileStorage.openPath(event, '/mock/notes/report.md')
      expect(shell.openPath).toHaveBeenCalledWith('/mock/notes/report.md')
    })

    it('refuses script extensions before reaching the OS handler', async () => {
      await expect(fileStorage.openPath(event, '/mock/notes/report.py')).rejects.toThrow('Refusing to open .py')
      expect(shell.openPath).not.toHaveBeenCalled()
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

      expect(shell.trashItem).toHaveBeenCalledWith(tmpFile)
    })

    it('normalizes Windows paths without relying on the test host platform', async () => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)

      await fileStorage.deleteExternalFile(event, 'C:/Users/test/Notes/note.md')

      expect(shell.trashItem).toHaveBeenCalledWith('C:\\Users\\test\\Notes\\note.md')
    })

    it('does not invoke the trash API for an empty path', async () => {
      await fileStorage.deleteExternalFile(event, '')

      expect(shell.trashItem).not.toHaveBeenCalled()
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

      expect(shell.trashItem).toHaveBeenCalledWith(tmpDir)
    })

    it('does not invoke the trash API for an empty path', async () => {
      await fileStorage.deleteExternalDir(event, '')

      expect(shell.trashItem).not.toHaveBeenCalled()
    })
  })

  // Round-trips through the real text branches of readFileCore; catches a
  // readFileSync → fs.promises.readFile swap regressing content or return type.
  describe('readExternalFile', () => {
    let tmpFile: string

    beforeEach(() => {
      tmpFile = path.join(os.tmpdir(), `filestorage-read-test-${uniqueId()}.md`)
      fs.writeFileSync(tmpFile, 'Hello 世界\nsecond line')
    })

    afterEach(() => {
      fs.rmSync(tmpFile, { force: true })
    })

    it('returns utf-8 file content verbatim (plain branch)', async () => {
      await expect(fileStorage.readExternalFile(event, tmpFile)).resolves.toBe('Hello 世界\nsecond line')
    })

    it('returns utf-8 file content verbatim (auto-encoding branch)', async () => {
      await expect(fileStorage.readExternalFile(event, tmpFile, true)).resolves.toBe('Hello 世界\nsecond line')
    })
  })

  // Catches an inverted canceled/filePath check (cancel writing a file, confirm
  // returning false) and a lost 'base64' encoding (literal base64 text on disk).
  describe('saveImage', () => {
    it('returns false and writes nothing when the save dialog is canceled', async () => {
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true, filePath: undefined } as never)

      await expect(fileStorage.saveImage(event, 'pic', 'data:image/png;base64,AAAA')).resolves.toBe(false)
    })

    it('decodes the base64 payload to disk and returns true on confirm', async () => {
      const tmpFile = path.join(os.tmpdir(), `filestorage-image-test-${uniqueId()}.png`)
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: tmpFile } as never)
      const payload = Buffer.from('fake-png-bytes').toString('base64')

      try {
        await expect(fileStorage.saveImage(event, 'pic', `data:image/png;base64,${payload}`)).resolves.toBe(true)
        expect(fs.readFileSync(tmpFile).equals(Buffer.from('fake-png-bytes'))).toBe(true)
      } finally {
        fs.rmSync(tmpFile, { force: true })
      }
    })
  })
})

function uniqueId(): string {
  return `${process.pid}-${Math.floor(Math.random() * 1e9)}`
}
