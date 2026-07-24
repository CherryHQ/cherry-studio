import { beforeEach, describe, expect, it, vi } from 'vitest'

const { showSaveDialogMock } = vi.hoisted(() => ({
  showSaveDialogMock: vi.fn()
}))

vi.mock('electron', () => ({
  dialog: { showSaveDialog: showSaveDialogMock }
}))

vi.mock('@application', () => ({
  application: { get: vi.fn() }
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }) }
}))

vi.mock('@main/services/file', () => ({
  dispatchHandle: vi.fn(),
  getMetadataByPath: vi.fn(),
  safeOpen: vi.fn(),
  showInFolder: vi.fn()
}))

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { ipcRequestSchemas } from '@shared/ipc/schemas/ipcSchemas'

import { fileHandlers } from '../file'

describe('file.select_save', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is registered on the global schema map', () => {
    expect(ipcRequestSchemas['file.select_save']).toBeDefined()
  })

  it('returns null on cancel and never writes a file', async () => {
    const probe = path.join(os.tmpdir(), `select-save-cancel-${Date.now()}.cherrybackup`)
    showSaveDialogMock.mockResolvedValueOnce({ canceled: true })

    await expect(fileHandlers['file.select_save'](undefined, { senderId: null })).resolves.toBeNull()
    expect(fs.existsSync(probe)).toBe(false)
  })

  it('returns the chosen path without writing', async () => {
    const chosen = path.join(os.tmpdir(), `select-save-ok-${Date.now()}.cherrybackup`)
    showSaveDialogMock.mockResolvedValueOnce({ canceled: false, filePath: chosen })

    await expect(
      fileHandlers['file.select_save'](
        { defaultPath: 'backup.cherrybackup', filters: [{ name: 'Cherry Backup', extensions: ['cherrybackup'] }] },
        { senderId: null }
      )
    ).resolves.toBe(chosen)
    expect(fs.existsSync(chosen)).toBe(false)
  })
})
