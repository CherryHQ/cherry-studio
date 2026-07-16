import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock } = vi.hoisted(() => ({ appGetMock: vi.fn() }))
vi.mock('@application', () => ({ application: { get: appGetMock } }))

import { backupHandlers } from '../backup'

const backupService = {
  startBackup: vi.fn(),
  startRestore: vi.fn(),
  cancel: vi.fn()
}

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'BackupService') return backupService
    throw new Error(`Unexpected application.get(${name})`)
  })
})

const ctx = { senderId: 'w1' }

describe('backupHandlers', () => {
  it('start_backup forwards preset + outputPath and returns { backupId, archivePath }', async () => {
    // startBackup may resolve a richer result; the handler must surface only the 2
    // route-output fields (the zod output schema is exactly { backupId, archivePath }).
    backupService.startBackup.mockResolvedValue({ backupId: 'b1', archivePath: '/out/full.cbu', extra: 'ignored' })
    const result = await backupHandlers['backup.start_backup']({ preset: 'full', outputPath: '/out/full.cbu' }, ctx)
    expect(backupService.startBackup).toHaveBeenCalledWith({ preset: 'full', outputPath: '/out/full.cbu' })
    expect(result).toEqual({ backupId: 'b1', archivePath: '/out/full.cbu' })
  })

  it('start_restore forwards archivePath and returns only restoreId', async () => {
    backupService.startRestore.mockResolvedValue({ restoreId: 'rst-1', journalPath: '/internal/ignored' })

    const result = await backupHandlers['backup.start_restore']({ archivePath: '/backups/full.cbu' }, ctx)

    expect(backupService.startRestore).toHaveBeenCalledWith({ archivePath: '/backups/full.cbu' })
    expect(result).toEqual({ restoreId: 'rst-1' })
  })

  it('cancel forwards backupId and returns the service result (match → cancelled)', async () => {
    backupService.cancel.mockReturnValue({ cancelled: true })
    const result = await backupHandlers['backup.cancel']({ backupId: 'b1' }, ctx)
    expect(backupService.cancel).toHaveBeenCalledWith('b1')
    expect(result).toEqual({ cancelled: true })
  })

  it('cancel returns { cancelled: false } when the service reports no match', async () => {
    backupService.cancel.mockReturnValue({ cancelled: false })
    const result = await backupHandlers['backup.cancel']({ backupId: 'other' }, ctx)
    expect(result).toEqual({ cancelled: false })
  })
})
