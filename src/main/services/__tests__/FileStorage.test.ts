import * as fs from 'fs'
import type * as fsPromises from 'node:fs/promises'
import * as os from 'os'
import * as path from 'path'

import { dialog, shell } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fsMocks = vi.hoisted(() => ({
  realpath: vi.fn(),
  originalRealpath: undefined as typeof fsPromises.realpath | undefined
}))

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof fsPromises>('node:fs/promises')
  fsMocks.originalRealpath = actual.realpath
  fsMocks.realpath.mockImplementation((...args: Parameters<typeof actual.realpath>) => actual.realpath(...args))
  return { ...actual, realpath: fsMocks.realpath }
})

// `t` pulls in i18n + preference machinery that isn't initialized under test; the
// dialog title it produces is irrelevant to these contracts, so stub it to the key.
vi.mock('@main/i18n', () => ({ t: (key: string) => key }))

import { fileStorage } from '../FileStorage'

const event = {} as Electron.IpcMainInvokeEvent

function createTempPathSwapFixture() {
  const physicalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'filestorage-physical-temp-'))
  const replacementRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'filestorage-replacement-temp-'))
  const redirectedRoot = `${physicalRoot}-redirected`
  const physicalDir = path.join(physicalRoot, 'CherryStudio')
  const replacementDir = path.join(replacementRoot, 'CherryStudio')
  const redirectedDir = path.join(redirectedRoot, 'CherryStudio')
  const redirectedFile = path.join(redirectedDir, 'screenshot.png')
  const physicalFile = path.join(physicalDir, 'screenshot.png')
  const replacementFile = path.join(replacementDir, 'screenshot.png')

  fs.mkdirSync(physicalDir)
  fs.mkdirSync(replacementDir)
  fs.symlinkSync(physicalRoot, redirectedRoot, process.platform === 'win32' ? 'junction' : 'dir')
  fsMocks.realpath.mockImplementation(async (target, options) => {
    if (path.resolve(String(target)) === redirectedDir) {
      throw Object.assign(new Error('realpath returned EISDIR'), { code: 'EISDIR' })
    }
    if (path.resolve(String(target)) === redirectedRoot) {
      const physicalPath = await fsMocks.originalRealpath!(target, options)
      fs.rmSync(redirectedRoot, { force: true, recursive: true })
      fs.symlinkSync(replacementRoot, redirectedRoot, process.platform === 'win32' ? 'junction' : 'dir')
      return physicalPath
    }
    return fsMocks.originalRealpath!(target, options)
  })

  return {
    redirectedFile,
    physicalFile,
    replacementFile,
    cleanup: () => {
      fs.rmSync(redirectedRoot, { force: true, recursive: true })
      fs.rmSync(physicalRoot, { recursive: true, force: true })
      fs.rmSync(replacementRoot, { recursive: true, force: true })
    }
  }
}

describe('FileStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fsMocks.realpath.mockImplementation((...args: Parameters<typeof fsPromises.realpath>) =>
      fsMocks.originalRealpath!(...args)
    )
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
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: '' })
      await expect(fileStorage.save(event, 'note.md', 'content')).resolves.toBeNull()
    })

    it('writes to the checked physical path if a redirected temp path changes during validation', async () => {
      const fixture = createTempPathSwapFixture()
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: fixture.redirectedFile })

      try {
        const savedPath = await fileStorage.save(event, 'screenshot.png', 'content')
        expect(savedPath).toBe(fixture.physicalFile)
        expect(fs.readFileSync(savedPath!, 'utf-8')).toBe('content')
        expect(fs.readFileSync(fixture.physicalFile, 'utf-8')).toBe('content')
        expect(fs.existsSync(fixture.replacementFile)).toBe(false)
      } finally {
        fixture.cleanup()
      }
    })

    it.skipIf(process.platform === 'win32')('preserves metadata when overwriting an existing file', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filestorage-save-metadata-'))
      const filePath = path.join(dir, 'existing.md')
      fs.writeFileSync(filePath, 'old content')
      fs.chmodSync(filePath, 0o640)
      const before = fs.statSync(filePath)
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath })

      try {
        await expect(fileStorage.save(event, 'existing.md', 'new content')).resolves.toBe(filePath)
        const after = fs.statSync(filePath)

        expect(fs.readFileSync(filePath, 'utf-8')).toBe('new content')
        expect({ dev: after.dev, ino: after.ino, mode: after.mode, uid: after.uid, gid: after.gid }).toEqual({
          dev: before.dev,
          ino: before.ino,
          mode: before.mode,
          uid: before.uid,
          gid: before.gid
        })
      } finally {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    })

    it.skipIf(process.platform === 'win32')('refuses to overwrite a hard-linked file', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filestorage-save-hardlink-'))
      const filePath = path.join(dir, 'existing.png')
      const aliasPath = path.join(dir, 'alias.png')
      fs.writeFileSync(filePath, 'original content')
      fs.linkSync(filePath, aliasPath)
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath })

      try {
        await expect(fileStorage.saveImage(event, 'existing', 'data:image/png;base64,bmV3IGNvbnRlbnQ=')).resolves.toBe(
          false
        )
        expect(fs.readFileSync(filePath, 'utf-8')).toBe('original content')
        expect(fs.readFileSync(aliasPath, 'utf-8')).toBe('original content')
      } finally {
        fs.rmSync(dir, { recursive: true, force: true })
      }
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

    it('writes a first-time temp file when its directory realpath reports EISDIR', async () => {
      const fixture = createTempPathSwapFixture()

      try {
        await fileStorage.writeFile(event, fixture.redirectedFile, new Uint8Array([1, 2, 3]))
        expect(fs.readFileSync(fixture.physicalFile)).toEqual(Buffer.from([1, 2, 3]))
        expect(fs.existsSync(fixture.replacementFile)).toBe(false)
      } finally {
        fixture.cleanup()
      }
    })

    it.skipIf(process.platform === 'win32')('preserves metadata when overwriting an existing file', async () => {
      fs.writeFileSync(tmpFile, 'private', { mode: 0o600 })
      fs.chmodSync(tmpFile, 0o600)
      const before = fs.statSync(tmpFile)

      await fileStorage.writeFile(event, tmpFile, 'updated')

      const after = fs.statSync(tmpFile)
      expect(fs.readFileSync(tmpFile, 'utf-8')).toBe('updated')
      expect({ dev: after.dev, ino: after.ino, mode: after.mode, uid: after.uid, gid: after.gid }).toEqual({
        dev: before.dev,
        ino: before.ino,
        mode: before.mode,
        uid: before.uid,
        gid: before.gid
      })
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

    it('resolves the normalized Windows path before moving it to trash', async () => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)

      await fileStorage.deleteExternalFile(event, 'C:/Users/test/Notes/note.md')

      expect(shell.trashItem).toHaveBeenCalledWith(path.resolve('C:\\Users\\test\\Notes\\note.md'))
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
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: tmpFile })
      const payload = Buffer.from('fake-png-bytes').toString('base64')

      try {
        await expect(fileStorage.saveImage(event, 'pic', `data:image/png;base64,${payload}`)).resolves.toBe(true)
        expect(fs.readFileSync(tmpFile).equals(Buffer.from('fake-png-bytes'))).toBe(true)
      } finally {
        fs.rmSync(tmpFile, { force: true })
      }
    })

    it('writes to the checked physical path if a redirected temp path changes during validation', async () => {
      const fixture = createTempPathSwapFixture()
      const payload = Buffer.from('fake-png-bytes').toString('base64')
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: fixture.redirectedFile })

      try {
        await expect(fileStorage.saveImage(event, 'screenshot', `data:image/png;base64,${payload}`)).resolves.toBe(true)
        expect(fs.readFileSync(fixture.physicalFile)).toEqual(Buffer.from('fake-png-bytes'))
        expect(fs.existsSync(fixture.replacementFile)).toBe(false)
      } finally {
        fixture.cleanup()
      }
    })

    it.skipIf(process.platform === 'win32')('preserves metadata when overwriting an existing image', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filestorage-image-metadata-'))
      const filePath = path.join(dir, 'existing.png')
      fs.writeFileSync(filePath, 'old image')
      fs.chmodSync(filePath, 0o640)
      const before = fs.statSync(filePath)
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath })

      try {
        await expect(fileStorage.saveImage(event, 'existing', 'data:image/png;base64,bmV3IGltYWdl')).resolves.toBe(true)
        const after = fs.statSync(filePath)

        expect(fs.readFileSync(filePath, 'utf-8')).toBe('new image')
        expect({ dev: after.dev, ino: after.ino, mode: after.mode, uid: after.uid, gid: after.gid }).toEqual({
          dev: before.dev,
          ino: before.ino,
          mode: before.mode,
          uid: before.uid,
          gid: before.gid
        })
      } finally {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    })
  })
})

function uniqueId(): string {
  return `${process.pid}-${Math.floor(Math.random() * 1e9)}`
}
