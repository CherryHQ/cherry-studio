import { backupErrorCodes } from '@shared/ipc/errors/backup'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const service = vi.hoisted(() => ({
  getStatus: vi.fn(),
  export: vi.fn(),
  prepareRestore: vi.fn(),
  cancelOperation: vi.fn(),
  cancelRestore: vi.fn(),
  armRestore: vi.fn(),
  rollbackRestore: vi.fn(),
  acknowledgeRestore: vi.fn()
}))
const windowMock = vi.hoisted(() => ({ id: 'window-1' }))
const getWindow = vi.hoisted(() => vi.fn(() => windowMock))
const showSaveDialog = vi.hoisted(() => vi.fn())
const showOpenDialog = vi.hoisted(() => vi.fn())
vi.mock('@application', () => ({
  application: { get: (name: string) => (name === 'WindowManager' ? { getWindow } : service) }
}))
vi.mock('@main/i18n', () => ({ t: () => 'Cherry Studio Backup' }))
vi.mock('electron', () => ({ dialog: { showSaveDialog, showOpenDialog } }))

import {
  ArchiveAdmissionError,
  BackupCancelledError,
  DiskFullError,
  InsufficientDiskSpaceError,
  OutputPathExistsError
} from '@main/services/backup'

import { backupHandlers } from '../backup'

const ctx = { senderId: 'window-1' }
beforeEach(() => {
  vi.clearAllMocks()
  getWindow.mockReturnValue(windowMock)
})

describe('backupHandlers', () => {
  it('does not expose unreadable journal details to the renderer', async () => {
    service.getStatus.mockReturnValue({ operation: null, restore: { kind: 'unreadable', error: '/private/journal' } })
    await expect(backupHandlers['backup.get_status'](undefined, ctx)).resolves.toEqual({
      operation: null,
      restore: { kind: 'unreadable' }
    })
  })

  it('opens a main-owned save dialog and returns closed Lite export degradations', async () => {
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/lite.cherrybackup' })
    service.export.mockResolvedValue({
      outPath: '/tmp/lite.cherrybackup',
      manifest: { degradations: [{ code: 'external-file-dropped', count: 2 }] }
    })
    await expect(backupHandlers['backup.export'](undefined, ctx)).resolves.toMatchObject({
      status: 'exported',
      degradations: [{ code: 'external-file-dropped', count: 2 }]
    })
    expect(service.export).toHaveBeenCalledWith('/tmp/lite.cherrybackup')
  })

  it('presents journal degradation totals after a relaunch without internal origins', async () => {
    service.getStatus.mockReturnValue({
      operation: null,
      restore: {
        kind: 'journal',
        state: 'completed',
        restoreId: '11111111-2222-4333-8444-555555555555',
        degradations: [
          { kind: 'report:export-db:external-file-dropped', reason: 'count:2' },
          { kind: 'report:restore-db:unknown', reason: 'count:1' }
        ]
      }
    })
    await expect(backupHandlers['backup.get_status'](undefined, ctx)).resolves.toMatchObject({
      restore: {
        degradations: [
          { code: 'external-file-dropped', count: 2 },
          { code: 'unknown', count: 1 }
        ]
      }
    })
  })

  it('rejects a hostile archive without forwarding its detail', async () => {
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/in.cherrybackup'] })
    service.prepareRestore.mockRejectedValue(new ArchiveAdmissionError('manifest-invalid', '/private/attacker'))
    await expect(backupHandlers['backup.prepare_restore'](undefined, ctx)).rejects.toMatchObject({
      code: backupErrorCodes.ARCHIVE_REJECTED
    })
  })

  it('maps incompatible migration chains to one bounded incompatibility error', async () => {
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/in.cherrybackup'] })
    service.prepareRestore.mockRejectedValue(new ArchiveAdmissionError('chain-incompatible', 'archive chain'))
    await expect(backupHandlers['backup.prepare_restore'](undefined, ctx)).rejects.toMatchObject({
      code: backupErrorCodes.RESTORE_INCOMPATIBLE
    })
  })

  it.each([
    [
      new InsufficientDiskSpaceError({ needed: 1, available: 0, path: '/private/sentinel' }),
      backupErrorCodes.STORAGE_UNAVAILABLE
    ],
    [new DiskFullError('/private/sentinel'), backupErrorCodes.STORAGE_UNAVAILABLE],
    [new OutputPathExistsError('/private/sentinel'), backupErrorCodes.EXPORT_DESTINATION]
  ])('does not expose path-bearing operational errors', async (error, code) => {
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/lite.cherrybackup' })
    service.export.mockRejectedValue(error)
    await expect(backupHandlers['backup.export'](undefined, ctx)).rejects.toMatchObject({
      code,
      message: expect.not.stringContaining('/private/sentinel')
    })
  })

  it('reports cooperative cancellation as canceled', async () => {
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/lite.cherrybackup' })
    service.export.mockRejectedValue(new BackupCancelledError())
    await expect(backupHandlers['backup.export'](undefined, ctx)).resolves.toEqual({ status: 'canceled' })
  })

  it('rejects mutating routes from detached renderers', async () => {
    await expect(
      backupHandlers['backup.arm_restore']({ restoreId: '11111111-2222-4333-8444-555555555555' }, { senderId: null })
    ).rejects.toMatchObject({ code: backupErrorCodes.SENDER_NOT_ALLOWED })
  })

  it('leaves an unclassified fault for the IPC framework to report as unexpected', async () => {
    const failure = new Error('EPERM')
    service.acknowledgeRestore.mockImplementation(() => {
      throw failure
    })
    await expect(backupHandlers['backup.acknowledge_restore'](undefined, ctx)).rejects.toBe(failure)
  })
})
