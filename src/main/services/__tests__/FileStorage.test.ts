import { dialog } from 'electron'
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
        '/mock/sys.home/Documents/x.txt'
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

    // CLI config files carry secrets (API keys, tokens) — callers that pass a mode must get that
    // exact mode back, not the platform default (0644, world-readable).
    it('chmods the file to the requested mode', async () => {
      await fileStorage.writeFile(event, tmpFile, 'secret content', 0o600)
      expect(fs.statSync(tmpFile).mode & 0o777).toBe(0o600)
    })

    // `fs.writeFile`'s `mode` option only takes effect when the file is created — an already-existing
    // file (e.g. a settings file being re-saved) keeps its prior mode unless explicitly chmod'd.
    it('chmods an already-existing file to the requested mode, not just new ones', async () => {
      fs.writeFileSync(tmpFile, 'old content', { mode: 0o644 })
      await fileStorage.writeFile(event, tmpFile, 'new content', 0o600)
      expect(fs.statSync(tmpFile).mode & 0o777).toBe(0o600)
    })

    it('does not touch the file mode when no mode is given', async () => {
      await fileStorage.writeFile(event, tmpFile, 'content')
      expect(fs.readFileSync(tmpFile, 'utf-8')).toBe('content')
    })
  })
})

function uniqueId(): string {
  return `${process.pid}-${Math.floor(Math.random() * 1e9)}`
}
