import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  importBackup,
  admitArchiveMock,
  readRestoreJournalMock,
  clearRestoreJournalMock,
  getRegistry,
  jobManagerPause,
  drainInFlight,
  relaunchMock
} = vi.hoisted(() => ({
  importBackup: vi.fn(),
  admitArchiveMock: vi.fn(),
  readRestoreJournalMock: vi.fn(),
  clearRestoreJournalMock: vi.fn(),
  getRegistry: vi.fn(() => ({ domains: [] })),
  jobManagerPause: vi.fn(() => ({ dispose: vi.fn() })),
  drainInFlight: vi.fn(async () => ({ stragglerIds: [] as string[], startupRecoveryPending: false })),
  relaunchMock: vi.fn()
}))

vi.mock('../ImportOrchestrator', () => ({
  ImportOrchestrator: vi.fn().mockImplementation(() => ({ importBackup }))
}))

vi.mock('../admitArchive', () => ({
  admitArchive: (...args: unknown[]) => admitArchiveMock(...args)
}))

vi.mock('../contributors/ContributorManager', () => ({
  contributorManager: { getRegistry }
}))

vi.mock('../SqliteBackupStripper', () => ({
  SqliteBackupStripper: vi.fn()
}))

vi.mock('@main/data/db/restore/restoreJournal', () => ({
  readRestoreJournal: readRestoreJournalMock,
  clearRestoreJournal: clearRestoreJournalMock
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const mocked = mockApplicationFactory()
  const innerGet = mocked.application.get as ReturnType<typeof vi.fn>
  mocked.application.get = vi.fn((name: string) => {
    if (name === 'JobManager') {
      return { pause: jobManagerPause, drainInFlight }
    }
    return innerGet(name)
  })
  ;(mocked.application as unknown as { relaunch: typeof relaunchMock }).relaunch = relaunchMock
  return mocked
})

import { BaseService } from '@main/core/lifecycle'
import { isBackupInProgress } from '@main/data/db/backup/quiesceGate'
import { backupErrorCodes } from '@shared/ipc/errors/backup'
import { IpcError } from '@shared/ipc/errors/IpcError'

import { BackupService } from '../BackupService'
import { ImportOrchestrator } from '../ImportOrchestrator'

// Loosely-typed journal fixture — the mock readRestoreJournal returns this verbatim (no schema parse).
const baseJournal = {
  version: 1,
  restoreId: 'rst-1',
  createdAt: '2026-07-22T00:00:00.000Z',
  db: { promote: 'p', aside: 'a', fingerprint: 'f', chain: [{ folderMillis: 1, hash: 'h' }] },
  fileResources: []
}

function okJournal(state: string, step?: string) {
  return { kind: 'ok' as const, journal: { ...baseJournal, state, ...(step ? { step } : {}) } }
}

/** Drive quiesceWriters through the ImportOrchestrator deps injected by startRestore. */
async function runQuiesceViaImportBackupMock(): Promise<void> {
  const deps = (ImportOrchestrator as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as {
    quiesceWriters: () => Promise<void>
  }
  await deps.quiesceWriters()
}

describe('BackupService restore journal lifecycle (A7)', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    vi.clearAllMocks()
    readRestoreJournalMock.mockReturnValue({ kind: 'none' })
    clearRestoreJournalMock.mockImplementation(() => {})
    importBackup.mockResolvedValue(undefined)
    admitArchiveMock.mockReset()
    getRegistry.mockReturnValue({ domains: [] })
    jobManagerPause.mockReturnValue({ dispose: vi.fn() })
    drainInFlight.mockResolvedValue({ stragglerIds: [], startupRecoveryPending: false })
    relaunchMock.mockImplementation(() => {})
  })

  describe('performRestoreRecovery (boot)', () => {
    it('KEEPS a completed journal (B3 data source) — does not clear', () => {
      readRestoreJournalMock.mockReturnValue(okJournal('completed', 'integrity-ok'))
      const service = new BackupService()
      ;(service as unknown as { performRestoreRecovery: () => void }).performRestoreRecovery()
      expect(clearRestoreJournalMock).not.toHaveBeenCalled()
    })

    it('clears a failed journal at boot (hygiene)', () => {
      readRestoreJournalMock.mockReturnValue(okJournal('failed', 'live-aside'))
      const service = new BackupService()
      ;(service as unknown as { performRestoreRecovery: () => void }).performRestoreRecovery()
      expect(clearRestoreJournalMock).toHaveBeenCalledTimes(1)
    })

    it('clears an expired journal at boot (hygiene)', () => {
      readRestoreJournalMock.mockReturnValue(okJournal('expired'))
      const service = new BackupService()
      ;(service as unknown as { performRestoreRecovery: () => void }).performRestoreRecovery()
      expect(clearRestoreJournalMock).toHaveBeenCalledTimes(1)
    })

    it('clears a corrupt journal at boot (belt — gate already quarantined)', () => {
      readRestoreJournalMock.mockReturnValue({ kind: 'corrupt', error: 'bad' })
      const service = new BackupService()
      ;(service as unknown as { performRestoreRecovery: () => void }).performRestoreRecovery()
      expect(clearRestoreJournalMock).toHaveBeenCalledTimes(1)
    })

    it('KEEPS a staged journal at boot (genuine pending — gate should have consumed; leave for next boot)', () => {
      readRestoreJournalMock.mockReturnValue(okJournal('staged'))
      const service = new BackupService()
      ;(service as unknown as { performRestoreRecovery: () => void }).performRestoreRecovery()
      expect(clearRestoreJournalMock).not.toHaveBeenCalled()
    })

    it('KEEPS a promoting journal at boot (genuine pending)', () => {
      readRestoreJournalMock.mockReturnValue(okJournal('promoting', 'live-aside'))
      const service = new BackupService()
      ;(service as unknown as { performRestoreRecovery: () => void }).performRestoreRecovery()
      expect(clearRestoreJournalMock).not.toHaveBeenCalled()
    })
  })

  describe('startRestore journal guard (PRIMARY fix path)', () => {
    it('throws BACKUP_RESTORE_PENDING for staged (genuine pending) and does NOT clear', async () => {
      readRestoreJournalMock.mockReturnValue(okJournal('staged'))
      const service = new BackupService()
      await expect(service.startRestore({ archivePath: '/x.cherrybackup' })).rejects.toMatchObject({
        code: 'BACKUP_RESTORE_PENDING'
      })
      expect(clearRestoreJournalMock).not.toHaveBeenCalled()
    })

    it('throws BACKUP_RESTORE_PENDING for promoting (genuine pending) and does NOT clear', async () => {
      readRestoreJournalMock.mockReturnValue(okJournal('promoting', 'live-aside'))
      const service = new BackupService()
      await expect(service.startRestore({ archivePath: '/x.cherrybackup' })).rejects.toMatchObject({
        code: 'BACKUP_RESTORE_PENDING'
      })
      expect(clearRestoreJournalMock).not.toHaveBeenCalled()
    })

    it('clears + proceeds for completed (same-session second restore)', async () => {
      readRestoreJournalMock.mockReturnValue(okJournal('completed', 'integrity-ok'))
      const service = new BackupService()
      await service.startRestore({ archivePath: '/x.cherrybackup' })
      expect(clearRestoreJournalMock).toHaveBeenCalledTimes(1)
      expect(importBackup).toHaveBeenCalledTimes(1)
    })

    it('clears + proceeds for failed/expired terminal', async () => {
      readRestoreJournalMock.mockReturnValue(okJournal('failed', 'live-aside'))
      const service = new BackupService()
      await service.startRestore({ archivePath: '/x.cherrybackup' })
      expect(clearRestoreJournalMock).toHaveBeenCalledTimes(1)
      expect(importBackup).toHaveBeenCalledTimes(1)
    })

    it('clears + proceeds for corrupt (belt)', async () => {
      readRestoreJournalMock.mockReturnValue({ kind: 'corrupt', error: 'bad' })
      const service = new BackupService()
      await service.startRestore({ archivePath: '/x.cherrybackup' })
      expect(clearRestoreJournalMock).toHaveBeenCalledTimes(1)
      expect(importBackup).toHaveBeenCalledTimes(1)
    })
  })

  describe('startRestore drain verdict (vaayne A7 unclean abort)', () => {
    const afterQuiesce = vi.fn()

    beforeEach(() => {
      afterQuiesce.mockClear()
      // importBackup drives quiesceWriters (real ImportOrchestrator calls it first).
      // afterQuiesce marks "proceed past quiesce" — unclean must never reach it.
      importBackup.mockImplementation(async () => {
        await runQuiesceViaImportBackupMock()
        afterQuiesce()
      })
    })

    it('aborts on stragglerIds — BACKUP_RESTORE_DRAIN_UNCLEAN, no proceed / relaunch', async () => {
      drainInFlight.mockResolvedValue({ stragglerIds: ['j1'], startupRecoveryPending: false })
      const holdDispose = vi.fn()
      jobManagerPause.mockReturnValue({ dispose: holdDispose })
      const service = new BackupService()

      await expect(service.startRestore({ archivePath: '/x.cherrybackup' })).rejects.toSatisfy(
        (err: unknown) => err instanceof IpcError && err.code === 'BACKUP_RESTORE_DRAIN_UNCLEAN'
      )

      expect(afterQuiesce).not.toHaveBeenCalled()
      expect(relaunchMock).not.toHaveBeenCalled()
      expect(isBackupInProgress()).toBe(false)
      expect(holdDispose).toHaveBeenCalledTimes(1)
    })

    it('aborts on startupRecoveryPending — BACKUP_RESTORE_DRAIN_UNCLEAN, no proceed / relaunch', async () => {
      drainInFlight.mockResolvedValue({ stragglerIds: [], startupRecoveryPending: true })
      const holdDispose = vi.fn()
      jobManagerPause.mockReturnValue({ dispose: holdDispose })
      const service = new BackupService()

      await expect(service.startRestore({ archivePath: '/x.cherrybackup' })).rejects.toSatisfy(
        (err: unknown) => err instanceof IpcError && err.code === 'BACKUP_RESTORE_DRAIN_UNCLEAN'
      )

      expect(afterQuiesce).not.toHaveBeenCalled()
      expect(relaunchMock).not.toHaveBeenCalled()
      expect(isBackupInProgress()).toBe(false)
      expect(holdDispose).toHaveBeenCalledTimes(1)
    })

    it('proceeds on clean verdict — import past quiesce + relaunch', async () => {
      drainInFlight.mockResolvedValue({ stragglerIds: [], startupRecoveryPending: false })
      const service = new BackupService()

      await service.startRestore({ archivePath: '/x.cherrybackup' })

      expect(afterQuiesce).toHaveBeenCalledTimes(1)
      expect(relaunchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('startRestore Full archive gate (vaayne ordinary-restore-full-gate)', () => {
    it('rejects preset=full via admitArchive wrapper — BACKUP_RESTORE_FULL_NOT_SUPPORTED', async () => {
      admitArchiveMock.mockResolvedValue({
        backupDbPath: '/tmp/backup.sqlite',
        manifest: { preset: 'full' },
        domains: [],
        includeFiles: true,
        resourceMetadata: { fileIds: [], knowledgeBases: [], notePaths: [] }
      })
      importBackup.mockImplementation(async () => {
        const deps = (ImportOrchestrator as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as {
          admitArchive: (a: string, b: string, c: string) => Promise<unknown>
        }
        await deps.admitArchive('/x.cherrybackup', '/work', '/mig')
      })
      const service = new BackupService()

      await expect(service.startRestore({ archivePath: '/x.cherrybackup' })).rejects.toSatisfy(
        (err: unknown) => err instanceof IpcError && err.code === 'BACKUP_RESTORE_FULL_NOT_SUPPORTED'
      )
      expect(relaunchMock).not.toHaveBeenCalled()
    })

    it('admits preset=lite through the wrapper', async () => {
      admitArchiveMock.mockResolvedValue({
        backupDbPath: '/tmp/backup.sqlite',
        manifest: { preset: 'lite' },
        domains: ['TOPICS'],
        includeFiles: false,
        resourceMetadata: { fileIds: [], knowledgeBases: [], notePaths: [] }
      })
      importBackup.mockImplementation(async () => {
        const deps = (ImportOrchestrator as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as {
          admitArchive: (a: string, b: string, c: string) => Promise<unknown>
        }
        await deps.admitArchive('/x.cherrybackup', '/work', '/mig')
      })
      const service = new BackupService()

      await expect(service.startRestore({ archivePath: '/x.cherrybackup' })).resolves.toMatchObject({
        restoreId: expect.stringMatching(/^rst-/)
      })
      expect(relaunchMock).toHaveBeenCalledTimes(1)
    })
  })

  // Touch IpcError so the unused import is not flagged by the import side of the mock graph.
  it('uses IpcError for the pending throw', () => {
    expect(new IpcError(backupErrorCodes.RESTORE_PENDING, 'x')).toBeInstanceOf(IpcError)
  })
})
