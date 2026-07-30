import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { application } from '@application'
import { MockMainProfileWriteBarrierServiceUtils } from '@test-mocks/main/ProfileWriteBarrierService'
import type { SaveDialogReturnValue } from 'electron'
import { dialog, shell } from 'electron'
import * as fs from 'fs'
import iconv from 'iconv-lite'
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
    MockMainProfileWriteBarrierServiceUtils.resetMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('legacy write ownership', () => {
    it('remains outside the lifecycle registry while v2 FileManager owns file writes', () => {
      const registrySource = readFileSync(resolve(__dirname, '../../core/application/serviceRegistry.ts'), 'utf8')

      expect(registrySource).not.toContain("import { FileStorage } from '@main/services/FileStorage'")
      expect(registrySource).not.toMatch(/^ {2}FileStorage,$/m)
    })

    it('runs managed pasted-image mutations through the profile write barrier', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)
      vi.spyOn(fs.promises, 'writeFile').mockResolvedValue()
      vi.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 3 } as fs.Stats)

      await fileStorage.savePastedImage(event, Buffer.from('img'), '.png')

      expect(application.get('ProfileWriteBarrierService').runWrite).toHaveBeenCalledWith(
        'file-storage:save-pasted-image',
        expect.any(Function)
      )
    })

    it('does not start a legacy path mutation until write admission resumes', async () => {
      let resume!: () => void
      const admission = new Promise<void>((resolveAdmission) => {
        resume = resolveAdmission
      })
      const runWrite = vi.mocked(application.get('ProfileWriteBarrierService').runWrite)
      runWrite.mockImplementation(async (_label, operation) => {
        await admission
        return operation()
      })
      const writeFile = vi.spyOn(fs.promises, 'writeFile').mockResolvedValue()

      const writing = fileStorage.writeFile(event, '/mock/app.userdata/notes/note.md', 'content')
      await Promise.resolve()

      expect(writeFile).not.toHaveBeenCalled()
      resume()
      await writing
      expect(writeFile).toHaveBeenCalledWith('/mock/app.userdata/notes/note.md', 'content')
    })

    it('does not admit a write whose target is entirely outside userData', async () => {
      const writeFile = vi.spyOn(fs.promises, 'writeFile').mockResolvedValue()

      await fileStorage.writeFile(event, '/external/notes/note.md', 'content')

      expect(writeFile).toHaveBeenCalledWith('/external/notes/note.md', 'content')
      expect(application.get('ProfileWriteBarrierService').runWrite).not.toHaveBeenCalled()
    })

    it('admits a move when either mutation endpoint crosses userData', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)
      vi.spyOn(fs.promises, 'rename').mockResolvedValue()

      await fileStorage.moveFile(event, '/external/note.md', '/mock/app.userdata/notes/note.md')

      expect(application.get('ProfileWriteBarrierService').runWrite).toHaveBeenCalledWith(
        'file-storage:move-file',
        expect.any(Function)
      )
    })

    it('classifies copy by its destination rather than its read-only source', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)
      vi.spyOn(fs.promises, 'copyFile').mockResolvedValue()

      await fileStorage.copyFile(event, 'blob-id.md', '/external/export.md')

      expect(application.get('ProfileWriteBarrierService').runWrite).not.toHaveBeenCalled()
    })
  })

  describe('save', () => {
    it('returns null (does not throw) when the save dialog is canceled', async () => {
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true, filePath: undefined } as never)
      await expect(fileStorage.save(event, 'note.md', 'content')).resolves.toBeNull()
      expect(application.get('ProfileWriteBarrierService').runWrite).not.toHaveBeenCalled()
    })

    it('returns null when the dialog resolves without a file path', async () => {
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: '' } as never)
      await expect(fileStorage.save(event, 'note.md', 'content')).resolves.toBeNull()
      expect(application.get('ProfileWriteBarrierService').runWrite).not.toHaveBeenCalled()
    })

    it('does not hold profile admission while waiting for the save dialog', async () => {
      let resolveDialog!: (value: SaveDialogReturnValue) => void
      vi.mocked(dialog.showSaveDialog).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveDialog = resolve
          })
      )
      vi.spyOn(fs.promises, 'writeFile').mockResolvedValue()

      const saving = fileStorage.save(event, 'note.md', 'content')
      await Promise.resolve()
      expect(application.get('ProfileWriteBarrierService').runWrite).not.toHaveBeenCalled()

      resolveDialog({ canceled: false, filePath: '/mock/app.userdata/export.md' })
      await expect(saving).resolves.toBe('/mock/app.userdata/export.md')
      expect(application.get('ProfileWriteBarrierService').runWrite).toHaveBeenCalledWith(
        'file-storage:save-file',
        expect.any(Function)
      )
    })

    it('opens the image dialog before admitting the selected profile write', async () => {
      const events: string[] = []
      const showSaveDialogSync = vi.fn(() => {
        events.push('dialog')
        return '/mock/app.userdata/image.png'
      })
      Object.defineProperty(dialog, 'showSaveDialogSync', {
        configurable: true,
        value: showSaveDialogSync
      })
      vi.mocked(application.get('ProfileWriteBarrierService').runWrite).mockImplementation(async (_label, work) => {
        events.push('admit')
        return work()
      })
      vi.spyOn(fs.promises, 'writeFile').mockImplementation(async () => {
        events.push('write')
      })

      await expect(fileStorage.saveImage(event, 'image', 'aW1n')).resolves.toBe(true)

      expect(events).toEqual(['dialog', 'admit', 'write'])
      Reflect.deleteProperty(dialog, 'showSaveDialogSync')
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

  describe('isTextFile', () => {
    let tmpFile: string

    beforeEach(() => {
      tmpFile = path.join(os.tmpdir(), `filestorage-text-test-${uniqueId()}`)
    })

    afterEach(() => {
      fs.rmSync(tmpFile, { force: true })
    })

    it('accepts an extensionless GBK text file', async () => {
      fs.writeFileSync(tmpFile, iconv.encode('这是一个没有扩展名的 GBK 文本文件，用于验证文件选择。', 'gbk'))

      await expect(fileStorage.isTextFile(event, tmpFile)).resolves.toBe(true)
    })

    it('accepts UTF-8 text when the sniff window ends inside a multibyte character', async () => {
      fs.writeFileSync(tmpFile, `${'a'.repeat(8 * 1024 - 1)}秋tail`)

      await expect(fileStorage.isTextFile(event, tmpFile)).resolves.toBe(true)
    })

    it('rejects an extensionless binary file', async () => {
      fs.writeFileSync(tmpFile, Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj'))

      await expect(fileStorage.isTextFile(event, tmpFile)).resolves.toBe(false)
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
      expect(application.get('ProfileWriteBarrierService').runWrite).not.toHaveBeenCalled()
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
      expect(application.get('ProfileWriteBarrierService').runWrite).not.toHaveBeenCalled()
    })

    it('admits a lexical userData target before moving it to trash', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)

      await fileStorage.deleteExternalFile(event, '/mock/app.userdata/notes/note.md')

      expect(application.get('ProfileWriteBarrierService').runWrite).toHaveBeenCalledWith(
        'file-storage:delete-external-file',
        expect.any(Function)
      )
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
})

function uniqueId(): string {
  return `${process.pid}-${Math.floor(Math.random() * 1e9)}`
}
