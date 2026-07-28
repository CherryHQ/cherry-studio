import { backupErrorCodes } from '@shared/ipc/errors/backup'
import { IpcError } from '@shared/ipc/errors/IpcError'
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
const applicationGet = vi.hoisted(() => vi.fn(() => service))
const showSaveDialog = vi.hoisted(() => vi.fn())
const showOpenDialog = vi.hoisted(() => vi.fn())

vi.mock('@application', () => ({ application: { get: applicationGet } }))
vi.mock('electron', () => ({ dialog: { showSaveDialog, showOpenDialog } }))

import {
  ArchiveAdmissionError,
  BackupBusyError,
  BackupCancelledError,
  InsufficientDiskSpaceError,
  RestoreStateError
} from '@main/services/backup'

import { backupHandlers } from '../backup'

/**
 * The handlers own three things and nothing else: who may call (a managed
 * window), where the file comes from or goes (main's own dialog), and which
 * stable code a structural failure becomes. Each test below pins one of them.
 */

const ctx = { senderId: 'w1' }
const detachedCtx = { senderId: null }

function manifest(preset: 'lite' | 'full') {
  return preset === 'lite'
    ? { preset, degradations: [{ kind: 'knowledge-base', reason: 'absent at snapshot time' }] }
    : { preset, degradations: [], resourcePayloads: [{ livePath: 'Data/KnowledgeBase/base-1' }] }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('backupHandlers', () => {
  describe('sender policy', () => {
    it.each([
      ['backup.export', () => backupHandlers['backup.export']({ preset: 'lite' }, detachedCtx)],
      ['backup.prepare_restore', () => backupHandlers['backup.prepare_restore'](undefined, detachedCtx)],
      ['backup.cancel_operation', () => backupHandlers['backup.cancel_operation'](undefined, detachedCtx)],
      ['backup.cancel_restore', () => backupHandlers['backup.cancel_restore'](undefined, detachedCtx)],
      ['backup.arm_restore', () => backupHandlers['backup.arm_restore'](undefined, detachedCtx)],
      ['backup.rollback_restore', () => backupHandlers['backup.rollback_restore'](undefined, detachedCtx)],
      ['backup.acknowledge_restore', () => backupHandlers['backup.acknowledge_restore'](undefined, detachedCtx)]
    ])('refuses %s from a caller that is not a managed window', async (_route, call) => {
      await expect(call()).rejects.toMatchObject({ code: backupErrorCodes.SENDER_NOT_ALLOWED })

      // Nothing was opened and nothing was delegated.
      expect(showSaveDialog).not.toHaveBeenCalled()
      expect(showOpenDialog).not.toHaveBeenCalled()
      expect(applicationGet).not.toHaveBeenCalled()
    })

    it('reads status for any caller — it changes nothing', async () => {
      service.getStatus.mockReturnValue({ operation: null, restore: { kind: 'none' } })

      await expect(backupHandlers['backup.get_status'](undefined, detachedCtx)).resolves.toEqual({
        operation: null,
        restore: { kind: 'none' }
      })
    })

    it('passes the journal degradation report to the renderer', async () => {
      const degradations = [{ kind: 'restore-db:note', reason: 'path-unportable (2 rows)' }]
      service.getStatus.mockReturnValue({
        operation: null,
        restore: { kind: 'journal', state: 'completed', restoreId: 'r1', preset: 'lite', degradations }
      })

      await expect(backupHandlers['backup.get_status'](undefined, detachedCtx)).resolves.toMatchObject({
        restore: { degradations }
      })
    })
  })

  describe('export', () => {
    it('never takes a path from the caller — main asks, then exports what the user chose', async () => {
      showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/backup.cherrybackup' })
      service.export.mockResolvedValue({ outPath: '/tmp/backup.cherrybackup', manifest: manifest('full') })

      const result = await backupHandlers['backup.export']({ preset: 'full' }, ctx)

      expect(service.export).toHaveBeenCalledWith('/tmp/backup.cherrybackup', 'full')
      expect(showSaveDialog).toHaveBeenCalledWith(
        expect.objectContaining({ filters: [{ name: 'Cherry Studio Backup', extensions: ['cherrybackup'] }] })
      )
      expect(result).toEqual({
        status: 'exported',
        archivePath: '/tmp/backup.cherrybackup',
        preset: 'full',
        resourceCount: 1,
        degradations: []
      })
    })

    it('reports a dismissed dialog as canceled without touching the service', async () => {
      showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined })

      await expect(backupHandlers['backup.export']({ preset: 'lite' }, ctx)).resolves.toEqual({ status: 'canceled' })
      expect(service.export).not.toHaveBeenCalled()
    })

    it('reports a Lite export as carrying no resources, degradations included', async () => {
      showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/backup.cherrybackup' })
      service.export.mockResolvedValue({ outPath: '/tmp/backup.cherrybackup', manifest: manifest('lite') })

      const result = await backupHandlers['backup.export']({ preset: 'lite' }, ctx)

      expect(result).toMatchObject({
        resourceCount: 0,
        degradations: [{ kind: 'knowledge-base', reason: 'absent at snapshot time' }]
      })
    })

    it('maps a concurrent operation to BUSY', async () => {
      showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/backup.cherrybackup' })
      service.export.mockRejectedValue(new BackupBusyError('prepare-restore', 'export'))

      await expect(backupHandlers['backup.export']({ preset: 'lite' }, ctx)).rejects.toMatchObject({
        code: backupErrorCodes.BUSY
      })
    })

    it('maps a destination the archive cannot be written to', async () => {
      showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/backup.cherrybackup' })
      service.export.mockRejectedValue(new InsufficientDiskSpaceError({ needed: 10, available: 1, path: '/tmp' }))

      await expect(backupHandlers['backup.export']({ preset: 'lite' }, ctx)).rejects.toMatchObject({
        code: backupErrorCodes.EXPORT_DESTINATION
      })
    })

    it('reports a cancelled export the same way a dismissed dialog is reported', async () => {
      showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/backup.cherrybackup' })
      service.export.mockRejectedValue(new BackupCancelledError())

      await expect(backupHandlers['backup.export']({ preset: 'lite' }, ctx)).resolves.toEqual({ status: 'canceled' })
    })
  })

  describe('prepare restore', () => {
    const preview = {
      restoreId: 'r1',
      preset: 'full' as const,
      coverage: { available: 2, missing: 1, unverifiable: 0 },
      resources: { install: 1, replace: 1 },
      degradations: [],
      migratedForward: true
    }

    it('opens the archive the user picked and returns the preview verbatim', async () => {
      showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/in.cherrybackup'] })
      service.prepareRestore.mockResolvedValue(preview)

      const result = await backupHandlers['backup.prepare_restore'](undefined, ctx)

      expect(service.prepareRestore).toHaveBeenCalledWith('/tmp/in.cherrybackup')
      expect(result).toEqual({ status: 'prepared', preview })
    })

    it('reports a dismissed dialog as canceled', async () => {
      showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })

      await expect(backupHandlers['backup.prepare_restore'](undefined, ctx)).resolves.toEqual({ status: 'canceled' })
      expect(service.prepareRestore).not.toHaveBeenCalled()
    })

    it('maps a rejected archive to a code carrying the admission reason', async () => {
      showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/in.cherrybackup'] })
      service.prepareRestore.mockRejectedValue(new ArchiveAdmissionError('chain-incompatible', 'ahead of this build'))

      await expect(backupHandlers['backup.prepare_restore'](undefined, ctx)).rejects.toMatchObject({
        code: backupErrorCodes.ARCHIVE_REJECTED,
        data: { reason: 'chain-incompatible' }
      })
    })

    it('reports a cancelled preparation as canceled, not as a failure', async () => {
      showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/in.cherrybackup'] })
      service.prepareRestore.mockRejectedValue(new BackupCancelledError())

      await expect(backupHandlers['backup.prepare_restore'](undefined, ctx)).resolves.toEqual({ status: 'canceled' })
    })
  })

  describe('cancel operation', () => {
    it('asks the service to abort and reports that it did', async () => {
      service.cancelOperation.mockReturnValue(true)

      await expect(backupHandlers['backup.cancel_operation'](undefined, ctx)).resolves.toEqual({ cancelled: true })
      expect(service.cancelOperation).toHaveBeenCalledTimes(1)
    })

    it('reports a request that found nothing running', async () => {
      service.cancelOperation.mockReturnValue(false)

      await expect(backupHandlers['backup.cancel_operation'](undefined, ctx)).resolves.toEqual({ cancelled: false })
    })
  })

  describe('restore lifecycle', () => {
    it.each([
      ['wrong-state' as const, backupErrorCodes.RESTORE_STATE],
      ['unreadable' as const, backupErrorCodes.JOURNAL_UNREADABLE],
      ['recovery-incomplete' as const, backupErrorCodes.RECOVERY_INCOMPLETE],
      ['relaunch-failed' as const, backupErrorCodes.ARM_FAILED],
      ['rollback-unavailable' as const, backupErrorCodes.ROLLBACK_UNAVAILABLE]
    ])('maps a %s refusal to %s', async (code, expected) => {
      service.armRestore.mockImplementation(() => {
        throw new RestoreStateError(code, 'refused')
      })

      await expect(backupHandlers['backup.arm_restore'](undefined, ctx)).rejects.toMatchObject({ code: expected })
    })

    it('delegates an explicit rollback request', async () => {
      await expect(backupHandlers['backup.rollback_restore'](undefined, ctx)).resolves.toBeUndefined()
      expect(service.rollbackRestore).toHaveBeenCalledOnce()
    })

    it('cancels a prepared restore', async () => {
      await expect(backupHandlers['backup.cancel_restore'](undefined, ctx)).resolves.toBeUndefined()
      expect(service.cancelRestore).toHaveBeenCalled()
    })

    it('returns what acknowledgement released', async () => {
      service.acknowledgeRestore.mockReturnValue({ acknowledged: true, restoreId: 'r1', removed: 3 })

      await expect(backupHandlers['backup.acknowledge_restore'](undefined, ctx)).resolves.toEqual({
        acknowledged: true,
        restoreId: 'r1',
        removed: 3
      })
    })

    it('lets an unpredicted fault through as itself rather than inventing a code', async () => {
      service.acknowledgeRestore.mockImplementation(() => {
        throw new Error('EPERM')
      })

      const error = await backupHandlers['backup.acknowledge_restore'](undefined, ctx).catch((e) => e)

      expect(error).not.toBeInstanceOf(IpcError)
      expect((error as Error).message).toBe('EPERM')
    })
  })
})
