import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { BrowserWindow, dialog, shell } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const documentParserMocks = vi.hoisted(() => ({
  extractWord: vi.fn(),
  parseOfficeAsync: vi.fn()
}))

// `t` pulls in i18n + preference machinery that isn't initialized under test; the
// dialog title it produces is irrelevant to these contracts, so stub it to the key.
vi.mock('@main/i18n', () => ({ t: (key: string) => key }))
vi.mock('officeparser', () => ({ default: { parseOfficeAsync: documentParserMocks.parseOfficeAsync } }))
vi.mock('word-extractor', () => ({
  default: class {
    extract = documentParserMocks.extractWord
  }
}))

import { fileStorage } from '../FileStorage'

const event = {} as Electron.IpcMainInvokeEvent

// The global electron mock has no BrowserWindow statics. Default the sender
// lookup to "no window" (unparented fallback); parented tests override it.
function mockSenderWindow(ownerWindow: Electron.BrowserWindow | null): Electron.IpcMainInvokeEvent {
  Object.assign(BrowserWindow, { fromWebContents: vi.fn(() => ownerWindow) })
  return { sender: {} as Electron.WebContents } as Electron.IpcMainInvokeEvent
}

describe('FileStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(BrowserWindow, { fromWebContents: vi.fn(() => null) })
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

    it.each([
      { rejection: new Error('dialog failed'), message: 'dialog failed' },
      { rejection: 'dialog failed', message: 'dialog failed' },
      { rejection: null, message: 'null' }
    ])('keeps a readable string rejection for $rejection', async ({ rejection, message }) => {
      vi.mocked(dialog.showSaveDialog).mockRejectedValueOnce(rejection)

      await expect(fileStorage.save(event, 'note.md', 'content')).rejects.toBe(
        `An error occurred saving the file: ${message}`
      )
    })

    it('parents the save dialog to the caller window, keeping a Unicode file name', async () => {
      const ownerWindow = { isDestroyed: () => false } as Electron.BrowserWindow
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true, filePath: undefined } as never)

      await expect(fileStorage.save(mockSenderWindow(ownerWindow), '测试-笔记-note.md', 'content')).resolves.toBeNull()

      expect(dialog.showSaveDialog).toHaveBeenCalledWith(
        ownerWindow,
        expect.objectContaining({ defaultPath: '测试-笔记-note.md' })
      )
    })

    it('falls back to an unparented dialog when the sender window is gone', async () => {
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true, filePath: undefined } as never)

      await expect(fileStorage.save(mockSenderWindow(null), '测试-笔记-note.md', 'content')).resolves.toBeNull()

      expect(dialog.showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: '测试-笔记-note.md' }))
    })

    it('falls back to an unparented dialog when the sender window is destroyed', async () => {
      const destroyedWindow = { isDestroyed: () => true } as Electron.BrowserWindow
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true, filePath: undefined } as never)

      await expect(
        fileStorage.save(mockSenderWindow(destroyedWindow), '测试-笔记-note.md', 'content')
      ).resolves.toBeNull()

      expect(dialog.showSaveDialog).toHaveBeenCalledTimes(1)
      expect(vi.mocked(dialog.showSaveDialog).mock.calls[0]).toHaveLength(1)
      expect(dialog.showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: '测试-笔记-note.md' }))
    })

    // The native dialog itself is mocked, but the confirmed path runs the real
    // Win32 filesystem write — on a Windows host this round-trips a CJK file
    // name end to end through the save branch.
    it('writes content to a CJK file path on the confirm path', async () => {
      const tmpFile = path.join(os.tmpdir(), `测试-笔记-${uniqueId()}.md`)
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: tmpFile })

      try {
        await expect(
          fileStorage.save(
            mockSenderWindow({ isDestroyed: () => false } as Electron.BrowserWindow),
            '测试-笔记.md',
            '你好世界'
          )
        ).resolves.toBe(tmpFile)
        expect(fs.readFileSync(tmpFile, 'utf-8')).toBe('你好世界')
      } finally {
        fs.rmSync(tmpFile, { force: true })
      }
    })
  })

  describe('mkdir', () => {
    it.each([
      { rejection: new Error('permission denied'), message: 'permission denied' },
      { rejection: 'permission denied', message: 'permission denied' },
      { rejection: null, message: 'null' }
    ])(
      'reports the directory failure without assuming an Error instance: $rejection',
      async ({ rejection, message }) => {
        const directory = path.join(os.tmpdir(), `filestorage-mkdir-${uniqueId()}`)
        vi.spyOn(fs.promises, 'mkdir').mockRejectedValueOnce(rejection)

        await expect(fileStorage.mkdir(event, directory)).rejects.toThrow(
          `Failed to create directory: ${directory}. Error: ${message}`
        )
      }
    )
  })

  describe('batchUploadMarkdownFiles', () => {
    it('continues after a non-Error folder failure and counts the affected file once', async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filestorage-upload-'))
      const target = path.join(root, 'export')
      const blocked = path.join(root, 'blocked', 'blocked.md')
      const good = path.join(root, 'good', 'good.md')
      fs.mkdirSync(path.dirname(blocked))
      fs.mkdirSync(path.dirname(good))
      fs.writeFileSync(blocked, 'blocked content')
      fs.writeFileSync(good, 'exported content')
      const mkdir = fs.promises.mkdir.bind(fs.promises)
      vi.spyOn(fs.promises, 'mkdir').mockImplementation(async (directory, options) => {
        if (path.basename(String(directory)) === 'blocked') throw null
        return mkdir(directory, options)
      })

      try {
        const result = await fileStorage.batchUploadMarkdownFiles(event, [blocked, good, 'ignored.txt'], target)

        expect(result).toMatchObject({ fileCount: 1, failedFiles: 1, skippedFiles: 1 })
        const exported = fs.readdirSync(target, { recursive: true }).filter((name) => name.endsWith('.md'))
        expect(exported.map((name) => fs.readFileSync(path.join(target, name), 'utf-8'))).toEqual(['exported content'])
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
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

    it('permanently deletes the file when the trash API fails', async () => {
      vi.mocked(shell.trashItem).mockRejectedValue(new Error('Failed to move item to trash'))

      await fileStorage.deleteExternalFile(event, tmpFile)

      expect(fs.existsSync(tmpFile)).toBe(false)
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

    it('extracts document content from an uppercase DOCX extension', async () => {
      const documentPath = path.join(os.tmpdir(), `filestorage-read-test-${uniqueId()}.DOCX`)
      fs.writeFileSync(documentPath, 'not plain text')
      documentParserMocks.parseOfficeAsync.mockResolvedValueOnce('extracted document text')

      try {
        await expect(fileStorage.readExternalFile(event, documentPath, true)).resolves.toBe('extracted document text')
      } finally {
        fs.rmSync(documentPath, { force: true })
      }
    })

    it('extracts document content from an uppercase DOC extension', async () => {
      const documentPath = path.join(os.tmpdir(), `filestorage-read-test-${uniqueId()}.DOC`)
      fs.writeFileSync(documentPath, 'not plain text')
      documentParserMocks.extractWord.mockResolvedValueOnce({
        getBody: () => 'extracted legacy document text',
        getTextboxes: () => '',
        getFootnotes: () => '',
        getEndnotes: () => ''
      })

      try {
        await expect(fileStorage.readExternalFile(event, documentPath, true)).resolves.toBe(
          'extracted legacy document text'
        )
      } finally {
        fs.rmSync(documentPath, { force: true })
      }
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
      const tmpFile = path.join(os.tmpdir(), `测试-图片-${uniqueId()}.png`)
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: tmpFile })
      const payload = Buffer.from('fake-png-bytes').toString('base64')

      try {
        await expect(fileStorage.saveImage(event, 'pic', `data:image/png;base64,${payload}`)).resolves.toBe(true)
        expect(fs.readFileSync(tmpFile).equals(Buffer.from('fake-png-bytes'))).toBe(true)
      } finally {
        fs.rmSync(tmpFile, { force: true })
      }
    })

    it('parents the image save dialog to the caller window, keeping a Unicode file name', async () => {
      const ownerWindow = { isDestroyed: () => false } as Electron.BrowserWindow
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true, filePath: undefined } as never)

      await expect(
        fileStorage.saveImage(mockSenderWindow(ownerWindow), '图片-导出', 'data:image/png;base64,AAAA')
      ).resolves.toBe(false)

      expect(dialog.showSaveDialog).toHaveBeenCalledWith(
        ownerWindow,
        expect.objectContaining({ defaultPath: '图片-导出.png' })
      )
    })

    it('falls back to an unparented dialog when the sender window is gone', async () => {
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true, filePath: undefined } as never)

      await expect(
        fileStorage.saveImage(mockSenderWindow(null), '图片-导出', 'data:image/png;base64,AAAA')
      ).resolves.toBe(false)

      expect(dialog.showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: '图片-导出.png' }))
    })
  })

  describe('fileNameGuard', () => {
    let tmpDir: string

    beforeEach(() => {
      tmpDir = path.join(os.tmpdir(), `filestorage-filenameguard-test-${uniqueId()}`)
      fs.mkdirSync(tmpDir, { recursive: true })
      fs.writeFileSync(path.join(tmpDir, 'a.md'), 'a')
      fs.writeFileSync(path.join(tmpDir, 'b.md'), 'b')
    })

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    it('reports that the requested name is already taken', async () => {
      const result = await fileStorage.fileNameGuard(event, tmpDir, 'b', true)
      expect(result.exists).toBe(true)
      // safeName stays the deduplicated suggestion for callers that want it
      expect(result.safeName).toBe('b1')
    })

    it('reports a fresh name as available and keeps it unchanged', async () => {
      const result = await fileStorage.fileNameGuard(event, tmpDir, 'fresh', true)
      expect(result.exists).toBe(false)
      expect(result.safeName).toBe('fresh')
    })

    it('applies the same rule to directories', async () => {
      fs.mkdirSync(path.join(tmpDir, 'folder'))
      const result = await fileStorage.fileNameGuard(event, tmpDir, 'folder', false)
      expect(result.exists).toBe(true)
      expect(result.safeName).toBe('folder1')
    })
  })

  describe('stored file ids', () => {
    it('rejects an id that escapes the storage directory', async () => {
      await expect(fileStorage.binaryImage(event, '../../../../etc/passwd')).rejects.toThrow(/Invalid stored file id/)
      await expect(fileStorage.binaryImage(event, '../database.sqlite')).rejects.toThrow(/Invalid stored file id/)
      await expect(fileStorage.binaryImage(event, '')).rejects.toThrow(/Invalid stored file id/)
      await expect(fileStorage.binaryImage(event, '.')).rejects.toThrow(/Invalid stored file id/)
    })

    it('accepts a plain file name', async () => {
      await expect(fileStorage.binaryImage(event, `${uniqueId()}.png`)).rejects.toMatchObject({ code: 'ENOENT' })
    })
  })
})

function uniqueId(): string {
  return `${process.pid}-${Math.floor(Math.random() * 1e9)}`
}
