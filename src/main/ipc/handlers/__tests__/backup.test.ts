import { backupErrorCodes } from '@shared/ipc/errors/backup'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
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
const windowManager = vi.hoisted(() => ({ getWindow: vi.fn(() => windowMock) }))
const applicationGet = vi.hoisted(() =>
  vi.fn((name: string) => {
    if (name === 'WindowManager') return windowManager
    return service
  })
)
const applicationGetPath = vi.hoisted(() => vi.fn(() => '/profile'))
const showSaveDialog = vi.hoisted(() => vi.fn())
const showOpenDialog = vi.hoisted(() => vi.fn())

vi.mock('@application', () => ({ application: { get: applicationGet, getPath: applicationGetPath } }))
vi.mock('@main/i18n', () => ({ t: () => 'Cherry Studio Backup' }))
vi.mock('electron', () => ({
  app: { getVersion: () => '2.0.0-beta.3', isPackaged: true },
  dialog: { showSaveDialog, showOpenDialog }
}))

import {
  ArchiveAdmissionError,
  BackupBusyError,
  BackupCancelledError,
  BackupFormatCompatibilityError,
  BackupMigrationCompatibilityError,
  BackupQuiesceError,
  CeilingExceededError,
  HardLinkUnsupportedError,
  InsufficientDiskSpaceError,
  NonRegularSourceError,
  OutputPathExistsError,
  ResourceInstallPlanError,
  RestoreStateError,
  SourceDriftError,
  UnportableSourceError
} from '@main/services/backup'

import { backupHandlers } from '../backup'

/**
 * The handlers own three things and nothing else: who may call (a managed
 * window), where the file comes from or goes (main's own dialog), and which
 * stable code a structural failure becomes. Each test below pins one of them.
 */

const ctx = { senderId: 'w1' }
const detachedCtx = { senderId: null }

function manifest(resourcePayloads: { livePath: string }[], degradations: { kind: string; reason: string }[] = []) {
  return { preset: 'full' as const, degradations, resourcePayloads }
}

beforeEach(() => {
  vi.clearAllMocks()
  windowManager.getWindow.mockReturnValue(windowMock)
})

describe('backupHandlers', () => {
  describe('sender policy', () => {
    it.each([
      ['backup.export', () => backupHandlers['backup.export'](undefined, detachedCtx)],
      ['backup.prepare_restore', () => backupHandlers['backup.prepare_restore'](undefined, detachedCtx)],
      ['backup.cancel_operation', () => backupHandlers['backup.cancel_operation'](undefined, detachedCtx)],
      ['backup.cancel_restore', () => backupHandlers['backup.cancel_restore'](undefined, detachedCtx)],
      ['backup.arm_restore', () => backupHandlers['backup.arm_restore']({ restoreId: 'r1' }, detachedCtx)],
      ['backup.rollback_restore', () => backupHandlers['backup.rollback_restore'](undefined, detachedCtx)],
      [
        'backup.acknowledge_restore',
        () => backupHandlers['backup.acknowledge_restore']({ knowledgeRebuild: 'require-complete' }, detachedCtx)
      ]
    ])('refuses %s from a caller that is not a managed window', async (_route, call) => {
      await expect(call()).rejects.toMatchObject({ code: backupErrorCodes.SENDER_NOT_ALLOWED })

      // Nothing was opened and nothing was delegated.
      expect(showSaveDialog).not.toHaveBeenCalled()
      expect(showOpenDialog).not.toHaveBeenCalled()
      expect(applicationGet).not.toHaveBeenCalled()
    })

    it('refuses a sender whose managed window disappeared before the dialog opened', async () => {
      windowManager.getWindow.mockReturnValueOnce(undefined as never)

      await expect(backupHandlers['backup.export'](undefined, ctx)).rejects.toMatchObject({
        code: backupErrorCodes.SENDER_NOT_ALLOWED
      })
      expect(showSaveDialog).not.toHaveBeenCalled()
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
        restore: { kind: 'journal', state: 'completed', restoreId: 'r1', degradations }
      })

      await expect(backupHandlers['backup.get_status'](undefined, detachedCtx)).resolves.toMatchObject({
        restore: { degradations: [{ code: 'path-unportable', count: 2 }] }
      })
    })

    it('preserves a compacted journal total and only safe bounded path samples', async () => {
      service.getStatus.mockReturnValue({
        operation: null,
        restore: {
          kind: 'journal',
          state: 'completed',
          restoreId: 'r1',
          degradations: [
            { kind: 'report:resource-changed', reason: 'count:500' },
            { kind: 'report-sample:resource-changed', reason: 'sample', livePath: 'Data/Notes/a' },
            { kind: 'report-sample:resource-changed', reason: 'sample', livePath: '/Users/private/note' },
            { kind: 'report-sample:resource-changed', reason: 'sample', livePath: 'Data/Notes/b' },
            { kind: 'report-sample:resource-changed', reason: 'sample', livePath: 'Data/Notes/c' },
            { kind: 'report-sample:resource-changed', reason: 'sample', livePath: 'Data/Notes/d' }
          ]
        }
      })

      const result = await backupHandlers['backup.get_status'](undefined, detachedCtx)

      expect(result).toMatchObject({
        restore: {
          degradations: [
            { code: 'resource-changed', count: 500, paths: ['Data/Notes/a', 'Data/Notes/b', 'Data/Notes/c'] }
          ]
        }
      })
      expect(JSON.stringify(result)).not.toContain('/Users/private')
    })
  })

  describe('export', () => {
    it('never takes a path from the caller — main asks, then exports what the user chose', async () => {
      showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/backup.cherrybackup' })
      service.export.mockResolvedValue({
        outPath: '/tmp/backup.cherrybackup',
        manifest: manifest([{ livePath: 'Data/KnowledgeBase/base-1' }])
      })

      const result = await backupHandlers['backup.export'](undefined, ctx)

      expect(service.export).toHaveBeenCalledWith('/tmp/backup.cherrybackup')
      expect(showSaveDialog).toHaveBeenCalledWith(
        windowMock,
        expect.objectContaining({ filters: [{ name: 'Cherry Studio Backup', extensions: ['cherrybackup'] }] })
      )
      expect(result).toEqual({
        status: 'exported',
        archivePath: '/tmp/backup.cherrybackup',
        resourceCount: 1,
        degradations: []
      })
    })

    it('reports a dismissed dialog as canceled without touching the service', async () => {
      showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined })

      await expect(backupHandlers['backup.export'](undefined, ctx)).resolves.toEqual({ status: 'canceled' })
      expect(service.export).not.toHaveBeenCalled()
    })

    it('reports an export that carried no resources, degradations included', async () => {
      showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/backup.cherrybackup' })
      service.export.mockResolvedValue({
        outPath: '/tmp/backup.cherrybackup',
        manifest: manifest([], [{ kind: 'resource:knowledge-base', reason: 'absent at snapshot time' }])
      })

      const result = await backupHandlers['backup.export'](undefined, ctx)

      expect(result).toMatchObject({
        resourceCount: 0,
        degradations: [{ code: 'resource-unavailable', count: 1 }]
      })
    })

    it('groups resource causes and exposes at most three safe relative samples', async () => {
      showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/backup.cherrybackup' })
      service.export.mockResolvedValue({
        outPath: '/tmp/backup.cherrybackup',
        manifest: {
          preset: 'full',
          resourcePayloads: [],
          degradations: [
            ...['a', 'b', 'c', 'd'].map((name) => ({
              kind: 'resource-entry:note-root',
              reason: 'external-reference',
              livePath: `Data/Notes/${name}`
            })),
            {
              kind: 'resource-entry:note-root',
              reason: 'external-reference',
              livePath: '/Users/private/note'
            },
            {
              kind: 'resource-entry:knowledge-base',
              reason: 'dangling-reference',
              livePath: 'Data/KnowledgeBase/k1/missing'
            },
            {
              kind: 'resource-entry:agent-workspace',
              reason: 'cyclic-reference',
              livePath: 'Data/Agents/system/a/loop'
            },
            {
              kind: 'resource-entry:skill',
              reason: 'unclassified-reference',
              livePath: 'Data/Skills/bad/device'
            }
          ]
        }
      })

      const result = await backupHandlers['backup.export'](undefined, ctx)

      expect(result.status).toBe('exported')
      if (result.status !== 'exported') return
      expect(result.degradations).toEqual([
        {
          code: 'external-reference',
          count: 5,
          paths: ['Data/Notes/a', 'Data/Notes/b', 'Data/Notes/c']
        },
        { code: 'dangling-reference', count: 1, paths: ['Data/KnowledgeBase/k1/missing'] },
        { code: 'cyclic-reference', count: 1, paths: ['Data/Agents/system/a/loop'] },
        { code: 'unclassified-reference', count: 1, paths: ['Data/Skills/bad/device'] }
      ])
      expect(JSON.stringify(result)).not.toContain('/Users/private')
    })

    it('maps a concurrent operation to BUSY', async () => {
      showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/backup.cherrybackup' })
      service.export.mockRejectedValue(new BackupBusyError('prepare-restore', 'export'))

      await expect(backupHandlers['backup.export'](undefined, ctx)).rejects.toMatchObject({
        code: backupErrorCodes.BUSY
      })
    })

    it('maps insufficient working space separately from an invalid output path', async () => {
      showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/backup.cherrybackup' })
      service.export.mockRejectedValue(new InsufficientDiskSpaceError({ needed: 10, available: 1, path: '/tmp' }))

      await expect(backupHandlers['backup.export'](undefined, ctx)).rejects.toMatchObject({
        code: backupErrorCodes.STORAGE_UNAVAILABLE
      })
    })

    it.each([
      [
        'source drift',
        new SourceDriftError('/profile/Data/Notes', 'tree changed'),
        { kind: 'source-changed', path: 'Data/Notes' }
      ],
      [
        'quiesce timeout',
        new BackupQuiesceError('profile-write-barrier', ['profile-write-1']),
        { kind: 'quiesce-timeout', phase: 'profile-write-barrier' }
      ],
      [
        'symlink or special file',
        new NonRegularSourceError('/profile/Data/Notes/link'),
        { kind: 'non-regular', path: 'Data/Notes/link' }
      ],
      [
        'unportable path',
        new UnportableSourceError('CON', 'invalid-path', '/profile/Data/Notes'),
        { kind: 'unportable-path', reason: 'invalid-path', path: 'Data/Notes/CON' }
      ],
      [
        'portable-name collision',
        new UnportableSourceError('Readme', 'name-collision', '/profile/Data/Notes'),
        { kind: 'unportable-path', reason: 'name-collision', path: 'Data/Notes/Readme' }
      ],
      [
        'source ceiling',
        new CeilingExceededError('entry-bytes', 'too large'),
        { kind: 'limit-exceeded', limit: 'entry-bytes' }
      ]
    ])('maps %s to a validated export-source diagnostic', async (_label, failure, diagnostic) => {
      showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/backup.cherrybackup' })
      service.export.mockRejectedValue(failure)

      await expect(backupHandlers['backup.export'](undefined, ctx)).rejects.toMatchObject({
        code: backupErrorCodes.EXPORT_SOURCE,
        data: diagnostic
      })
    })

    it('never forwards an export source path outside userData', async () => {
      showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/backup.cherrybackup' })
      service.export.mockRejectedValue(new SourceDriftError('/Users/private/notes', 'tree changed'))

      const error = await backupHandlers['backup.export'](undefined, ctx).catch((cause) => cause)

      expect(error).toMatchObject({
        code: backupErrorCodes.EXPORT_SOURCE,
        data: { kind: 'source-changed' }
      })
      expect(JSON.stringify((error as IpcError).toJSON())).not.toContain('/Users/private')
    })

    it('omits an unportable path when its profile root is unknown', async () => {
      showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/backup.cherrybackup' })
      service.export.mockRejectedValue(new UnportableSourceError('/Users/private/CON', 'invalid-path'))

      const error = await backupHandlers['backup.export'](undefined, ctx).catch((cause) => cause)

      expect(error).toMatchObject({
        code: backupErrorCodes.EXPORT_SOURCE,
        data: { kind: 'unportable-path', reason: 'invalid-path' }
      })
      expect(JSON.stringify((error as IpcError).toJSON())).not.toContain('/Users/private')
    })

    it('bounds internal quiesce and ceiling labels before sending them over IPC', async () => {
      showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/backup.cherrybackup' })
      service.export
        .mockRejectedValueOnce(new BackupQuiesceError('/Users/private', []))
        .mockRejectedValueOnce(new CeilingExceededError('/Users/private', 'too large'))

      await expect(backupHandlers['backup.export'](undefined, ctx)).rejects.toMatchObject({
        data: { kind: 'quiesce-timeout', phase: 'unknown' }
      })
      await expect(backupHandlers['backup.export'](undefined, ctx)).rejects.toMatchObject({
        data: { kind: 'limit-exceeded', limit: 'unknown' }
      })
    })

    it('reports a cancelled export the same way a dismissed dialog is reported', async () => {
      showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/backup.cherrybackup' })
      service.export.mockRejectedValue(new BackupCancelledError())

      await expect(backupHandlers['backup.export'](undefined, ctx)).resolves.toEqual({ status: 'canceled' })
    })
  })

  describe('prepare restore', () => {
    const preview = {
      restoreId: 'r1',
      coverage: { available: 2, missing: 1, unverifiable: 0 },
      resources: { install: 1, replace: 1 },
      degradations: [],
      migratedForward: true
    }

    it('opens the archive the user picked and returns the preview verbatim', async () => {
      showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/in.cherrybackup'] })
      service.prepareRestore.mockResolvedValue(preview)

      const result = await backupHandlers['backup.prepare_restore'](undefined, ctx)

      expect(showOpenDialog).toHaveBeenCalledWith(
        windowMock,
        expect.objectContaining({ filters: [{ name: 'Cherry Studio Backup', extensions: ['cherrybackup'] }] })
      )
      expect(service.prepareRestore).toHaveBeenCalledWith('/tmp/in.cherrybackup')
      expect(result).toEqual({ status: 'prepared', preview })
    })

    it('reports a dismissed dialog as canceled', async () => {
      showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })

      await expect(backupHandlers['backup.prepare_restore'](undefined, ctx)).resolves.toEqual({ status: 'canceled' })
      expect(service.prepareRestore).not.toHaveBeenCalled()
    })

    it('maps a hostile rejected archive to a generic code without forwarding its detail', async () => {
      showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/in.cherrybackup'] })
      service.prepareRestore.mockRejectedValue(
        new ArchiveAdmissionError('manifest-invalid', 'attacker text /Users/private/archive')
      )

      const error = await backupHandlers['backup.prepare_restore'](undefined, ctx).catch((cause) => cause)
      expect(error).toMatchObject({
        code: backupErrorCodes.ARCHIVE_REJECTED,
        data: { reason: 'manifest-invalid' }
      })
      expect((error as IpcError).message).toBe('backup archive was rejected')
      expect(JSON.stringify((error as IpcError).data)).not.toContain('/Users/private')
    })

    it('records the refusal in the main log, where the detail is diagnostic rather than exposure', async () => {
      // The renderer is told a code and a fixed sentence, so this line is the
      // only surviving account of WHY an archive was turned away. Losing it
      // makes a rejected restore indistinguishable from nothing happening.
      showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/in.cherrybackup'] })
      const cause = new ArchiveAdmissionError('manifest-invalid', 'requirement-set: declares 8, requires 10')
      service.prepareRestore.mockRejectedValue(cause)

      await backupHandlers['backup.prepare_restore'](undefined, ctx).catch(() => undefined)

      expect(mockMainLoggerService.warn).toHaveBeenCalledWith(
        'Backup request refused',
        { code: backupErrorCodes.ARCHIVE_REJECTED },
        cause
      )
    })

    it.each([
      ['source-ahead' as const, backupErrorCodes.RESTORE_REQUIRES_NEWER_APP],
      ['lineage-fork' as const, backupErrorCodes.RESTORE_LINEAGE_INCOMPATIBLE]
    ])('maps %s to a bounded compatibility diagnostic', async (kind, code) => {
      showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/in.cherrybackup'] })
      const common = {
        archiveAppVersion: '2.0.0-beta.3',
        archiveBuildType: 'development' as const,
        sourceMigrationCount: 28,
        targetMigrationCount: 26,
        sourceTip: {
          folderMillis: 1785221482684,
          hash: 'ab77963210cae53b84c77a0e750986e4ed2a369b83f342826d6713fd75e40a30'
        },
        targetTip: { folderMillis: 1785000000000, hash: 'not-safe-to-render /Users/private' }
      }
      service.prepareRestore.mockRejectedValue(
        new BackupMigrationCompatibilityError(
          kind === 'source-ahead'
            ? { ...common, kind, missingMigrationCount: 2, firstExtraIndex: 27 }
            : { ...common, kind, firstDivergentIndex: 20 }
        )
      )

      await expect(backupHandlers['backup.prepare_restore'](undefined, ctx)).rejects.toMatchObject({
        code,
        data: {
          kind,
          archiveAppVersion: '2.0.0-beta.3',
          archiveBuildType: 'development',
          currentAppVersion: '2.0.0-beta.3',
          currentBuildType: 'packaged',
          sourceMigrationCount: 28,
          targetMigrationCount: 26,
          sourceTip: { folderMillis: 1785221482684, hashPrefix: 'ab77963210ca' },
          targetTip: { folderMillis: 1785000000000, hashPrefix: 'unavailable' }
        }
      })
    })

    it('maps a newer backup format without forwarding manifest payload fields', async () => {
      showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/in.cherrybackup'] })
      service.prepareRestore.mockRejectedValue(
        new BackupFormatCompatibilityError({
          archiveFormatVersion: 3,
          archiveAppVersion: '2.1.0',
          archiveBuildType: 'packaged'
        })
      )

      await expect(backupHandlers['backup.prepare_restore'](undefined, ctx)).rejects.toMatchObject({
        code: backupErrorCodes.FORMAT_UNSUPPORTED,
        data: {
          kind: 'archive-newer',
          archiveFormatVersion: 3,
          currentFormatVersion: 2,
          archiveAppVersion: '2.1.0',
          archiveBuildType: 'packaged',
          currentAppVersion: '2.0.0-beta.3',
          currentBuildType: 'packaged'
        }
      })
    })

    it('maps a target resource conflict to its restore-specific code', async () => {
      showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/in.cherrybackup'] })
      service.prepareRestore.mockRejectedValue(new ResourceInstallPlanError('target-symlink', 'Data/Notes'))

      await expect(backupHandlers['backup.prepare_restore'](undefined, ctx)).rejects.toMatchObject({
        code: backupErrorCodes.RESTORE_RESOURCES,
        data: { reason: 'target-symlink' }
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

  /**
   * The boundary may expose only the failure class and a bounded closed
   * diagnostic. Every class below is thrown twice, from two different absolute
   * paths with two different underlying sentences, and the assertion is that the
   * two serialized payloads are byte-identical — a substring search for one
   * leaked path would pass for a message that leaks a different one.
   */
  describe('error hygiene', () => {
    async function payload(fault: unknown) {
      service.acknowledgeRestore.mockImplementationOnce(() => {
        throw fault
      })
      const error = await backupHandlers['backup.acknowledge_restore']({ knowledgeRebuild: 'abandon' }, ctx).catch(
        (cause) => cause
      )
      expect(error).toBeInstanceOf(IpcError)
      return (error as IpcError).toJSON()
    }

    it.each([
      [
        'storage',
        backupErrorCodes.STORAGE_UNAVAILABLE,
        undefined,
        [
          new InsufficientDiskSpaceError({ needed: 10, available: 1, path: '/Users/ann/Library/CherryStudio' }),
          new InsufficientDiskSpaceError({ needed: 77, available: 3, path: 'D:\\profiles\\bob\\cherry' })
        ]
      ],
      [
        'export source',
        backupErrorCodes.EXPORT_SOURCE,
        { kind: 'source-changed' },
        [
          new SourceDriftError('/Users/ann/Notes/secret plan.md', 'mtime'),
          new SourceDriftError('/home/bob/kb/private.pdf', 'size')
        ]
      ],
      [
        'export destination',
        backupErrorCodes.EXPORT_DESTINATION,
        undefined,
        [
          new OutputPathExistsError('/Users/ann/Desktop/a.cherrybackup'),
          new HardLinkUnsupportedError('/mnt/n/b.cherrybackup')
        ]
      ],
      [
        'journal',
        backupErrorCodes.JOURNAL_UNREADABLE,
        undefined,
        [
          new RestoreStateError('unreadable', 'ENOENT /Users/ann/Library/CherryStudio/restore-journal.json'),
          new RestoreStateError('unreadable', 'invalid json at /home/bob/.config/cherry/restore-journal.json')
        ]
      ]
    ])('says only which %s failure happened', async (_label, code, data, [first, second]) => {
      const one = await payload(first)
      const two = await payload(second)

      expect(one).toEqual({
        code,
        message: expect.any(String),
        ...(data === undefined ? {} : { data })
      })
      expect(two).toEqual(one)
    })

    it('keeps a resource refusal distinguishable by its closed reason alone', async () => {
      expect(
        await payload(new ResourceInstallPlanError('cross-filesystem', '/Users/ann/Library/CherryStudio/kb'))
      ).toEqual({
        code: backupErrorCodes.RESTORE_RESOURCES,
        message: 'the backup files cannot be installed on this device',
        data: { reason: 'cross-filesystem' }
      })
    })

    it('keeps a restore-state refusal distinguishable by its closed reason alone', async () => {
      expect(await payload(new RestoreStateError('unsafe-artifact', 'symlink at /Users/ann/restore-staging'))).toEqual({
        code: backupErrorCodes.RESTORE_STATE,
        message: 'the restore is not in a state that allows this action',
        data: { reason: 'unsafe-artifact' }
      })
    })

    it('reports an unreadable journal in the status without any detail', async () => {
      service.getStatus.mockReturnValue({
        busy: false,
        operation: null,
        restore: { kind: 'unreadable' }
      })

      await expect(backupHandlers['backup.get_status'](undefined, ctx)).resolves.toMatchObject({
        restore: { kind: 'unreadable' }
      })
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
      service.armRestore.mockImplementationOnce(() => {
        throw new RestoreStateError(code, 'refused')
      })

      await expect(backupHandlers['backup.arm_restore']({ restoreId: 'r1' }, ctx)).rejects.toMatchObject({
        code: expected
      })
    })

    it('binds arming to the restore preview the user confirmed', async () => {
      await expect(backupHandlers['backup.arm_restore']({ restoreId: 'r1' }, ctx)).resolves.toBeUndefined()
      expect(service.armRestore).toHaveBeenCalledWith('r1')
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

      await expect(backupHandlers['backup.acknowledge_restore']({ knowledgeRebuild: 'abandon' }, ctx)).resolves.toEqual(
        {
          acknowledged: true,
          restoreId: 'r1',
          removed: 3
        }
      )
      expect(service.acknowledgeRestore).toHaveBeenCalledWith('abandon')
    })

    it('strips an unpredicted fault down to a detail-free internal error', async () => {
      // The dangerous case: nobody wrote this message for a renderer, so it can
      // carry anything — here, the user's home directory.
      service.acknowledgeRestore.mockImplementation(() => {
        throw new Error("EPERM: operation not permitted, unlink '/Users/someone/Library/App/cherrystudio.sqlite'")
      })

      const error = await backupHandlers['backup.acknowledge_restore'](
        { knowledgeRebuild: 'require-complete' },
        ctx
      ).catch((e) => e)

      expect(error).toBeInstanceOf(IpcError)
      expect((error as IpcError).toJSON()).toEqual({
        code: 'INTERNAL',
        message: 'the backup operation failed unexpectedly'
      })
    })
  })
})
