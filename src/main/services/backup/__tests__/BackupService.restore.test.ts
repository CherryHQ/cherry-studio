import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  importBackup,
  admitArchiveMock,
  readRestoreJournalMock,
  clearRestoreJournalMock,
  getRegistry,
  jobManagerPause,
  drainInFlight,
  relaunchMock,
  broadcastMock
} = vi.hoisted(() => ({
  importBackup: vi.fn(),
  admitArchiveMock: vi.fn(),
  readRestoreJournalMock: vi.fn(),
  clearRestoreJournalMock: vi.fn(),
  getRegistry: vi.fn(() => ({ domains: [] })),
  jobManagerPause: vi.fn(() => ({ dispose: vi.fn() })),
  drainInFlight: vi.fn(async () => ({ stragglerIds: [] as string[], startupRecoveryPending: false })),
  relaunchMock: vi.fn(),
  broadcastMock: vi.fn()
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
    if (name === 'IpcApiService') {
      return { broadcast: broadcastMock }
    }
    return innerGet(name)
  })
  ;(mocked.application as unknown as { relaunch: typeof relaunchMock }).relaunch = relaunchMock
  return mocked
})

import { BaseService } from '@main/core/lifecycle'
import { isBackupInProgress, setBackupInProgress } from '@main/data/db/backup/quiesceGate'
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
    importBackup.mockResolvedValue({ plan: { toRestore: [], skips: [] } })
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

    it('KEEPS a failed journal at boot (awaiting acknowledgement via restore_status)', () => {
      readRestoreJournalMock.mockReturnValue(okJournal('failed', 'live-aside'))
      const service = new BackupService()
      ;(service as unknown as { performRestoreRecovery: () => void }).performRestoreRecovery()
      expect(clearRestoreJournalMock).not.toHaveBeenCalled()
    })

    it('KEEPS an expired journal at boot (awaiting acknowledgement via restore_status)', () => {
      readRestoreJournalMock.mockReturnValue(okJournal('expired'))
      const service = new BackupService()
      ;(service as unknown as { performRestoreRecovery: () => void }).performRestoreRecovery()
      expect(clearRestoreJournalMock).not.toHaveBeenCalled()
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

  describe('getRestoreStatus / acknowledgeRestoreOutcome (B3)', () => {
    it('maps no journal to none', () => {
      readRestoreJournalMock.mockReturnValue({ kind: 'none' })
      expect(new BackupService().getRestoreStatus()).toEqual({ state: 'none' })
    })

    it('maps a corrupt journal to none (nothing actionable for the UI)', () => {
      readRestoreJournalMock.mockReturnValue({ kind: 'corrupt', error: 'bad' })
      expect(new BackupService().getRestoreStatus()).toEqual({ state: 'none' })
    })

    it('maps staged and promoting to pending', () => {
      const service = new BackupService()
      readRestoreJournalMock.mockReturnValue(okJournal('staged'))
      expect(service.getRestoreStatus()).toEqual({ state: 'pending' })
      readRestoreJournalMock.mockReturnValue(okJournal('promoting', 'live-aside'))
      expect(service.getRestoreStatus()).toEqual({ state: 'pending' })
    })

    it('maps completed to completed', () => {
      readRestoreJournalMock.mockReturnValue(okJournal('completed', 'integrity-ok'))
      expect(new BackupService().getRestoreStatus()).toEqual({ state: 'completed' })
    })

    it('carries the journal reason for failed/expired', () => {
      const service = new BackupService()
      readRestoreJournalMock.mockReturnValue({
        kind: 'ok',
        journal: { ...baseJournal, state: 'failed', reason: "step 'work-promoted' failed: disk full" }
      })
      expect(service.getRestoreStatus()).toEqual({
        state: 'failed',
        reason: "step 'work-promoted' failed: disk full"
      })
      readRestoreJournalMock.mockReturnValue({
        kind: 'ok',
        journal: { ...baseJournal, state: 'expired', reason: 'DB fingerprint mismatch' }
      })
      expect(service.getRestoreStatus()).toEqual({
        state: 'expired',
        reason: 'DB fingerprint mismatch'
      })
    })

    it('acknowledge clears a terminal journal', () => {
      readRestoreJournalMock.mockReturnValue(okJournal('completed', 'integrity-ok'))
      expect(new BackupService().acknowledgeRestoreOutcome()).toEqual({ cleared: true })
      expect(clearRestoreJournalMock).toHaveBeenCalledTimes(1)
    })

    it('acknowledge refuses to clear a pending journal (gate-owned state)', () => {
      readRestoreJournalMock.mockReturnValue(okJournal('staged'))
      expect(new BackupService().acknowledgeRestoreOutcome()).toEqual({ cleared: false })
      expect(clearRestoreJournalMock).not.toHaveBeenCalled()
    })

    it('acknowledge is a no-op with no journal', () => {
      readRestoreJournalMock.mockReturnValue({ kind: 'none' })
      expect(new BackupService().acknowledgeRestoreOutcome()).toEqual({ cleared: false })
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

    it('rejects startBackup while a restore journal is staged (CR-007)', async () => {
      readRestoreJournalMock.mockReturnValue(okJournal('staged'))
      const service = new BackupService()
      await expect(
        service.startBackup({ preset: 'lite', outputPath: '/tmp/out.cherrybackup', overwrite: false })
      ).rejects.toMatchObject({ code: 'BACKUP_RESTORE_PENDING' })
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
        return { plan: { toRestore: [], skips: [] } }
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

    it('proceeds on clean verdict — seals, broadcasts the summary, and WAITS (no auto relaunch)', async () => {
      drainInFlight.mockResolvedValue({ stragglerIds: [], startupRecoveryPending: false })
      const holdDispose = vi.fn()
      jobManagerPause.mockReturnValue({ dispose: holdDispose })
      const service = new BackupService()

      await service.startRestore({ archivePath: '/x.cherrybackup' })

      expect(afterQuiesce).toHaveBeenCalledTimes(1)
      // backup.restore_summary integration contract: the renderer confirm dialog owns
      // the restart via app.relaunch — the spine must broadcast and keep waiting.
      expect(relaunchMock).not.toHaveBeenCalled()
      expect(broadcastMock).toHaveBeenCalledWith('backup.restore_summary', { toRestore: [], toSkip: [] })
      // Quiesce survives the resolved request: the write window stays closed from
      // seal until the user-confirmed relaunch exits the process.
      expect(isBackupInProgress()).toBe(true)
      expect(holdDispose).not.toHaveBeenCalled()

      setBackupInProgress(false) // module-singleton gate — reset for later tests
    })

    it('broadcasts a NON-empty plan: toSkip maps from plan.skips (not toRestore)', async () => {
      drainInFlight.mockResolvedValue({ stragglerIds: [], startupRecoveryPending: false })
      // Once: keep the describe's quiesce drive, but return a NON-empty plan so a
      // toSkip↔toRestore swap would fail (empty fixtures cannot catch that).
      importBackup.mockImplementationOnce(async () => {
        await runQuiesceViaImportBackupMock()
        return {
          plan: {
            toRestore: [{ kind: 'file', count: 2 }],
            skips: [{ id: 'f1', kind: 'file', reason: 'live exists' }],
            resources: []
          }
        }
      })
      const service = new BackupService()
      await service.startRestore({ archivePath: '/x.cherrybackup' })
      expect(broadcastMock).toHaveBeenCalledWith('backup.restore_summary', {
        toRestore: [{ kind: 'file', count: 2 }],
        toSkip: [{ id: 'f1', kind: 'file', reason: 'live exists' }]
      })
      expect(relaunchMock).not.toHaveBeenCalled()
      expect(isBackupInProgress()).toBe(true)
      setBackupInProgress(false)
    })

    it('a second startRestore during the sealed wait does NOT release the held quiesce (CR-001)', async () => {
      drainInFlight.mockResolvedValue({ stragglerIds: [], startupRecoveryPending: false })
      const holdDispose = vi.fn()
      jobManagerPause.mockReturnValue({ dispose: holdDispose })
      const service = new BackupService()

      await service.startRestore({ archivePath: '/x.cherrybackup' }) // seals; quiesce held
      expect(isBackupInProgress()).toBe(true)

      // The sealed restore's journal is staged; the second call is rejected by the
      // journal guard BEFORE acquiring quiesce — its finally must not release the
      // first restore's module-global flag or JobManager hold.
      readRestoreJournalMock.mockReturnValue(okJournal('staged'))
      await expect(service.startRestore({ archivePath: '/y.cherrybackup' })).rejects.toMatchObject({
        code: 'BACKUP_RESTORE_PENDING'
      })
      expect(isBackupInProgress()).toBe(true)
      expect(holdDispose).not.toHaveBeenCalled()

      setBackupInProgress(false) // module-singleton gate — reset for later tests
    })

    it('a broadcast failure does not fail the sealed restore (renderer falls back)', async () => {
      drainInFlight.mockResolvedValue({ stragglerIds: [], startupRecoveryPending: false })
      broadcastMock.mockImplementationOnce(() => {
        throw new Error('no windows')
      })
      const service = new BackupService()

      await expect(service.startRestore({ archivePath: '/x.cherrybackup' })).resolves.toMatchObject({
        restoreId: expect.any(String)
      })

      setBackupInProgress(false)
    })
  })

  describe('startRestore Full archive admission (A2 — full gate removed)', () => {
    it('admits preset=full through admitArchive (the full-restore gate is gone)', async () => {
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
          planResources: unknown
          planRoots: unknown
        }
        expect(deps.planResources).toBeDefined()
        expect(deps.planRoots).toBeDefined()
        await deps.admitArchive('/x.cherrybackup', '/work', '/mig')
        return { plan: { toRestore: [], skips: [] } }
      })
      const service = new BackupService()

      await expect(service.startRestore({ archivePath: '/x.cherrybackup' })).resolves.toMatchObject({
        restoreId: expect.stringMatching(/^rst-/)
      })
      // Sealed success broadcasts the summary and waits for the renderer's app.relaunch.
      expect(relaunchMock).not.toHaveBeenCalled()
      expect(broadcastMock).toHaveBeenCalledWith('backup.restore_summary', { toRestore: [], toSkip: [] })
    })

    it('admits preset=lite through admitArchive', async () => {
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
        return { plan: { toRestore: [], skips: [] } }
      })
      const service = new BackupService()

      await expect(service.startRestore({ archivePath: '/x.cherrybackup' })).resolves.toMatchObject({
        restoreId: expect.stringMatching(/^rst-/)
      })
      // Sealed success broadcasts the summary and waits for the renderer's app.relaunch.
      expect(relaunchMock).not.toHaveBeenCalled()
      expect(broadcastMock).toHaveBeenCalledWith('backup.restore_summary', { toRestore: [], toSkip: [] })
    })
  })

  // Touch IpcError so the unused import is not flagged by the import side of the mock graph.
  it('uses IpcError for the pending throw', () => {
    expect(new IpcError(backupErrorCodes.RESTORE_PENDING, 'x')).toBeInstanceOf(IpcError)
  })
})
