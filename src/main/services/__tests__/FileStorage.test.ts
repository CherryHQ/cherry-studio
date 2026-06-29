import { dialog } from 'electron'
import * as fs from 'fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// `t` pulls in i18n + preference machinery that isn't initialized under test; the
// dialog title it produces is irrelevant to these contracts, so stub it to the key.
vi.mock('@main/utils/language', () => ({ t: (key: string) => key }))

const { officeConvertMock } = vi.hoisted(() => ({ officeConvertMock: vi.fn() }))
vi.mock('officeparser', () => ({
  OfficeConverter: {
    convert: officeConvertMock
  }
}))

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

  describe('readExternalFile', () => {
    it('disables image and chart extraction for Office text reads', async () => {
      const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValueOnce(true)
      officeConvertMock.mockResolvedValueOnce({ value: ' office body ' })

      await expect(fileStorage.readExternalFile(event, '/tmp/report.docx')).resolves.toBe(' office body ')

      expect(officeConvertMock).toHaveBeenCalledWith(
        '/tmp/report.docx',
        'text',
        expect.objectContaining({
          generatorConfig: expect.objectContaining({
            includeImages: false,
            includeCharts: false,
            textConfig: expect.objectContaining({
              newlineDelimiter: '\n',
              preserveLayout: true
            })
          })
        })
      )
      existsSpy.mockRestore()
    })

    it('rejects unsupported legacy Excel files instead of returning empty content', async () => {
      const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValueOnce(true)

      await expect(fileStorage.readExternalFile(event, '/tmp/report.xls')).rejects.toThrow(
        'Unsupported document format: .xls'
      )
      expect(officeConvertMock).not.toHaveBeenCalled()
      existsSpy.mockRestore()
    })
  })
})
