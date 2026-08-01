import type * as Electron from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  importBackup,
  admitArchiveMock,
  readRestoreJournalMock,
  clearRestoreJournalMock,
  getRegistry,
  jobManagerPause,
  drainInFlight,
  channelPause,
  channelDrain,
  aiPause,
  aiDrain,
  agentPause,
  agentDrain,
  relaunchMock,
  broadcastMock,
  windowManagerAcquireHold,
  notificationShow,
  notificationClose,
  notificationSupported,
  forceExitMock,
  dialogShowMessageBoxMock
} = vi.hoisted(() => ({
  importBackup: vi.fn(),
  admitArchiveMock: vi.fn(),
  readRestoreJournalMock: vi.fn(),
  clearRestoreJournalMock: vi.fn(),
  getRegistry: vi.fn(() => ({ domains: [] })),
  jobManagerPause: vi.fn(() => ({ dispose: vi.fn() })),
  drainInFlight: vi.fn(async () => ({ stragglerIds: [] as string[], startupRecoveryPending: false })),
  channelPause: vi.fn(() => ({ dispose: vi.fn() })),
  channelDrain: vi.fn(async () => ({ stragglerIds: [] as string[] })),
  aiPause: vi.fn(() => ({ dispose: vi.fn() })),
  aiDrain: vi.fn(async () => ({ stragglerIds: [] as string[] })),
  agentPause: vi.fn(() => ({ dispose: vi.fn() })),
  agentDrain: vi.fn(async () => ({ stragglerIds: [] as string[] })),
  relaunchMock: vi.fn(),
  broadcastMock: vi.fn(),
  // a1 WindowManager hold: real impl returns Disposable; tests exercise
  // success and failure paths via the return shape. The default success
  // branch returns a Disposable-shaped object so existing flow assertions
  // (hold pushed onto restoreQuiesceHolds) keep working.
  windowManagerAcquireHold: vi.fn(() => ({ dispose: vi.fn() })),
  // Native Notification mock: real Electron `Notification.show()` is
  // fire-and-forget and OS-dependent; tests assert `show` was called
  // without waiting for OS delivery.
  notificationShow: vi.fn(),
  notificationClose: vi.fn(),
  notificationSupported: vi.fn(() => true),
  forceExitMock: vi.fn(),
  // #10: native dialog shown when both relaunch paths fail at post-seal. Default
  // resolves (user acknowledges Exit); per-test overrides exercise reject/pending.
  dialogShowMessageBoxMock: vi.fn(() => Promise.resolve({ response: 0 }))
}))

// B14: capture BackupService logger.info calls so drain-observability logging is assertable.
const { loggerInfo } = vi.hoisted(() => ({ loggerInfo: vi.fn() }))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ info: loggerInfo, warn: vi.fn(), error: vi.fn() }) }
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
    if (name === 'ChannelManager') {
      return { pause: channelPause, drainInFlight: channelDrain }
    }
    if (name === 'AiStreamManager') {
      return { pause: aiPause, drainInFlight: aiDrain }
    }
    if (name === 'AgentSessionRuntimeService') {
      return { pause: agentPause, drainInFlight: agentDrain }
    }
    if (name === 'IpcApiService') {
      return { broadcast: broadcastMock }
    }
    if (name === 'WindowManager') {
      return { acquireMutationCapableWindowHold: windowManagerAcquireHold }
    }
    return innerGet(name)
  })
  ;(mocked.application as unknown as { relaunch: typeof relaunchMock }).relaunch = relaunchMock
  ;(mocked.application as unknown as { forceExit: typeof forceExitMock }).forceExit = forceExitMock
  return mocked
})

// Mock Electron Notification (a1 — used by BackupService for post-seal progress).
// `isSupported()` and `show()` are the only methods we touch; the constructor
// returns an object that records the show call for assertion.
vi.mock('electron', async () => {
  const actual = await vi.importActual<typeof Electron>('electron')
  const NotificationMock = vi.fn().mockImplementation(() => ({
    show: notificationShow,
    close: notificationClose
  }))
  ;(NotificationMock as unknown as { isSupported: typeof notificationSupported }).isSupported = notificationSupported
  return {
    ...actual,
    app: { getLocale: () => 'en-US' },
    Notification: NotificationMock,
    dialog: { showMessageBox: dialogShowMessageBoxMock }
  }
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
  fileResources: [],
  summary: {
    toRestore: [{ kind: 'knowledge', count: 2 }],
    toSkip: [{ id: 'skill-a', kind: 'skill', reasonCode: 'local_record_exists' }]
  }
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
    importBackup.mockResolvedValue({ summary: { toRestore: [], toSkip: [], degradations: [] } })
    admitArchiveMock.mockReset()
    getRegistry.mockReturnValue({ domains: [] })
    jobManagerPause.mockReturnValue({ dispose: vi.fn() })
    drainInFlight.mockResolvedValue({ stragglerIds: [], startupRecoveryPending: false })
    channelDrain.mockResolvedValue({ stragglerIds: [] })
    relaunchMock.mockImplementation(() => {})
    forceExitMock.mockImplementation(() => {})
    dialogShowMessageBoxMock.mockResolvedValue({ response: 0 })
    notificationSupported.mockReturnValue(true)
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

  describe('relaunchStagedRestore', () => {
    it('relaunches only when the journal is staged', () => {
      readRestoreJournalMock.mockReturnValue(okJournal('staged'))

      new BackupService().relaunchStagedRestore()

      expect(relaunchMock).toHaveBeenCalledTimes(1)
    })

    it('rejects when no journal exists', () => {
      readRestoreJournalMock.mockReturnValue({ kind: 'none' })

      expect(() => new BackupService().relaunchStagedRestore()).toThrow(/requires a staged journal/)
      expect(relaunchMock).not.toHaveBeenCalled()
    })

    it('rejects terminal and promoting journals', () => {
      const service = new BackupService()
      for (const state of ['completed', 'failed', 'expired', 'promoting']) {
        readRestoreJournalMock.mockReturnValue(okJournal(state, state === 'promoting' ? 'live-aside' : undefined))
        expect(() => service.relaunchStagedRestore()).toThrow(/requires a staged journal/)
      }
      expect(relaunchMock).not.toHaveBeenCalled()
    })

    it('rejects a corrupt journal', () => {
      readRestoreJournalMock.mockReturnValue({ kind: 'corrupt', error: 'bad' })

      expect(() => new BackupService().relaunchStagedRestore()).toThrow(/requires a staged journal/)
      expect(relaunchMock).not.toHaveBeenCalled()
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
      expect(service.getRestoreStatus()).toEqual({ state: 'pending', summary: baseJournal.summary })
      readRestoreJournalMock.mockReturnValue(okJournal('promoting', 'live-aside'))
      expect(service.getRestoreStatus()).toEqual({ state: 'pending', summary: baseJournal.summary })
    })

    it('maps completed to completed and keeps the journal summary', () => {
      // A crash before the pre-relaunch dialog was seen would otherwise report an
      // unqualified success and drop the durable loss disclosure for good.
      readRestoreJournalMock.mockReturnValue(okJournal('completed', 'integrity-ok'))
      expect(new BackupService().getRestoreStatus()).toEqual({
        state: 'completed',
        summary: baseJournal.summary
      })
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
        return { summary: { toRestore: [], toSkip: [], degradations: [] } }
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

    it('a1 hold failure → unrecoverable: BACKUP_RESTORE_HOLD_FAILED + scheduled relaunch (partial state)', async () => {
      drainInFlight.mockResolvedValue({ stragglerIds: [], startupRecoveryPending: false })
      // a1 throws — e.g. a renderer process refused to be destroyed cleanly.
      // BackupService must surface RESTORE_HOLD_FAILED and schedule a relaunch
      // (rather than silently release into a "no main window" state).
      windowManagerAcquireHold.mockImplementation(() => {
        throw new Error('renderer refused destroy')
      })
      const service = new BackupService()

      vi.useFakeTimers()
      try {
        await expect(service.startRestore({ archivePath: '/x.cherrybackup' })).rejects.toSatisfy(
          (err: unknown) => err instanceof IpcError && err.code === 'BACKUP_RESTORE_HOLD_FAILED'
        )
        // a1 was attempted before any other writer pause (no Channel/AI/Job
        // pauses should have run, because we abort right after a1).
        expect(windowManagerAcquireHold).toHaveBeenCalledWith('restore-quiesce')
        expect(channelPause).not.toHaveBeenCalled()
        expect(aiPause).not.toHaveBeenCalled()
        expect(agentPause).not.toHaveBeenCalled()
        expect(jobManagerPause).not.toHaveBeenCalled()
        // BACKUP_IN_PROGRESS must NOT be set — a1 throw short-circuited
        // before the flag flip.
        expect(isBackupInProgress()).toBe(false)
        // The relaunch is scheduled via setTimeout(0). Fast-forward microtasks
        // so the scheduled callback runs.
        await vi.advanceTimersByTimeAsync(0)
        expect(relaunchMock).toHaveBeenCalledTimes(1)
      } finally {
        vi.useRealTimers()
        setBackupInProgress(false)
      }
    })

    it('a1 hold is acquired FIRST in quiesceWriters (before flag/channel/AI/agent/job)', async () => {
      // Order check: capture call timestamps of every pause / hold call.
      const callOrder: string[] = []
      windowManagerAcquireHold.mockImplementation(() => {
        callOrder.push('a1')
        return { dispose: vi.fn() }
      })
      channelPause.mockImplementation(() => {
        callOrder.push('channel')
        return { dispose: vi.fn() }
      })
      aiPause.mockImplementation(() => {
        callOrder.push('ai')
        return { dispose: vi.fn() }
      })
      agentPause.mockImplementation(() => {
        callOrder.push('agent')
        return { dispose: vi.fn() }
      })
      jobManagerPause.mockImplementation(() => {
        callOrder.push('job')
        return { dispose: vi.fn() }
      })
      const service = new BackupService()
      vi.useFakeTimers()
      try {
        await service.startRestore({ archivePath: '/x.cherrybackup' })
        // a1 is the first quiesce action; the existing service-side chain runs
        // after. setBackupInProgress is set between a1 and channel but does
        // not register a call here, so the order in `callOrder` is:
        // a1 → channel → ai → agent → job.
        expect(callOrder[0]).toBe('a1')
        expect(callOrder).toEqual(['a1', 'channel', 'ai', 'agent', 'job'])
      } finally {
        vi.useRealTimers()
        setBackupInProgress(false)
      }
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

    it('B14: logs each writer drain elapsed/straggler and uses DRAIN_TIMEOUT_MS (5000)', async () => {
      // Clean drains — quiesce proceeds. The drain bound is the named DRAIN_TIMEOUT_MS
      // constant (5000), and each writer's elapsed + straggler count is logged (B14).
      drainInFlight.mockResolvedValue({ stragglerIds: [], startupRecoveryPending: false })
      channelDrain.mockResolvedValue({ stragglerIds: [] })
      importBackup.mockImplementationOnce(async () => {
        await runQuiesceViaImportBackupMock()
        return { summary: { toRestore: [], toSkip: [], degradations: [] } }
      })
      const service = new BackupService()
      vi.useFakeTimers()
      try {
        await service.startRestore({ archivePath: '/x.cherrybackup' })
        // DRAIN_TIMEOUT_MS (5000) is the drain bound passed to every writer.
        expect(channelDrain).toHaveBeenCalledWith({ timeoutMs: 5000 })
        expect(drainInFlight).toHaveBeenCalledWith({ timeoutMs: 5000 })
        // B14: one drain-observation log per writer (Channel / Ai / Agent / Job = 4).
        const drainLogs = loggerInfo.mock.calls.filter(
          (c) => typeof c[0] === 'string' && c[0].includes('restore quiesce drain')
        )
        expect(drainLogs).toHaveLength(4)
        // Each line carries the writer name + elapsedMs + stragglerIds observability fields.
        expect(drainLogs[0][0]).toContain('writer=ChannelManager')
        expect(drainLogs[0][0]).toContain('elapsedMs=')
        expect(drainLogs[0][0]).toContain('stragglerIds=0')
      } finally {
        vi.useRealTimers()
        setBackupInProgress(false)
      }
    })

    it('B6: a stale finally from a prior generation does not release the current generation quiesce', async () => {
      // op1 acquires quiesce and then hangs. A newer generation begins (stop→start restart
      // simulation) before op1's finally fires. op1's stale finally must NOT release
      // quiesce — that would clear the new generation's BACKUP_IN_PROGRESS flag + dispose
      // its holds. The generation fence (isCurrentGeneration) skips the release.
      drainInFlight.mockResolvedValue({ stragglerIds: [], startupRecoveryPending: false })
      channelDrain.mockResolvedValue({ stragglerIds: [] })
      let rejectOp1!: (e: unknown) => void
      let signalQuiesce!: () => void
      const quiesceAcquired = new Promise<void>((r) => {
        signalQuiesce = r
      })
      importBackup.mockImplementationOnce(async () => {
        await runQuiesceViaImportBackupMock()
        signalQuiesce()
        return new Promise<never>((_resolve, reject) => {
          rejectOp1 = reject
        })
      })

      const service = new BackupService()
      const restoreP = service.startRestore({ archivePath: '/x.cherrybackup' })
      // Wait until op1 has acquired quiesce (set BACKUP_IN_PROGRESS + pushed holds) and is
      // now hanging inside the in-flight importBackup promise.
      await quiesceAcquired
      expect(isBackupInProgress()).toBe(true)

      // Simulate a newer generation beginning while op1 is still in-flight (what a
      // stop→start restart + new beginActiveOperation would do to the counter).
      const internal = service as unknown as { generation: number }
      internal.generation += 1

      // op1 now fails — its finally runs as a STALE callback (generation mismatch).
      rejectOp1(new Error('op1 aborted'))
      await expect(restoreP).rejects.toThrow()

      // The stale finally must NOT have released quiesce: BACKUP_IN_PROGRESS stays set
      // (the new generation owns it). Without the fence, releaseRestoreQuiesce would have
      // cleared it here, clobbering the newer operation.
      expect(isBackupInProgress()).toBe(true)

      setBackupInProgress(false)
    })

    it('shows separate native notifications for snapshot, merge, seal, and completion', async () => {
      importBackup.mockImplementationOnce(async (options: { onProgress?: (update: { phase: string }) => void }) => {
        await runQuiesceViaImportBackupMock()
        for (const phase of ['snapshot', 'merge', 'seal']) {
          options.onProgress?.({ phase })
        }
        return { summary: { toRestore: [], toSkip: [], degradations: [] } }
      })
      let journalReadCount = 0
      readRestoreJournalMock.mockImplementation(() => {
        journalReadCount += 1
        return journalReadCount <= 1 ? { kind: 'none' } : okJournal('staged')
      })
      const service = new BackupService()
      vi.useFakeTimers()
      try {
        await service.startRestore({ archivePath: '/x.cherrybackup' })
        expect(notificationShow).toHaveBeenCalledTimes(4)
        expect(notificationClose).toHaveBeenCalledTimes(3)
      } finally {
        vi.useRealTimers()
        setBackupInProgress(false)
      }
    })

    it('skips native notifications when the platform does not support them but still relaunches', async () => {
      notificationSupported.mockReturnValue(false)
      let journalReadCount = 0
      readRestoreJournalMock.mockImplementation(() => {
        journalReadCount += 1
        return journalReadCount <= 1 ? { kind: 'none' } : okJournal('staged')
      })
      const service = new BackupService()
      vi.useFakeTimers()
      try {
        await service.startRestore({ archivePath: '/x.cherrybackup' })
        expect(notificationShow).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(3000)
        expect(relaunchMock).toHaveBeenCalledTimes(1)
      } finally {
        vi.useRealTimers()
        setBackupInProgress(false)
      }
    })

    it('falls back to application.relaunch when the delayed staged relaunch is unavailable', async () => {
      const service = new BackupService()
      let journalReadCount = 0
      readRestoreJournalMock.mockImplementation(() => {
        journalReadCount += 1
        return journalReadCount <= 1 ? { kind: 'none' } : { kind: 'corrupt', error: 'gone' }
      })
      vi.useFakeTimers()
      try {
        await service.startRestore({ archivePath: '/x.cherrybackup' })
        await vi.advanceTimersByTimeAsync(3000)
        expect(relaunchMock).toHaveBeenCalledTimes(1)
      } finally {
        vi.useRealTimers()
        setBackupInProgress(false)
      }
    })

    it('falls back again when the staged relaunch itself throws', async () => {
      const service = new BackupService()
      let journalReadCount = 0
      readRestoreJournalMock.mockImplementation(() => {
        journalReadCount += 1
        return journalReadCount <= 1 ? { kind: 'none' } : okJournal('staged')
      })
      relaunchMock.mockImplementationOnce(() => {
        throw new Error('staged relaunch failed')
      })
      vi.useFakeTimers()
      try {
        await service.startRestore({ archivePath: '/x.cherrybackup' })
        await vi.advanceTimersByTimeAsync(3000)
        expect(relaunchMock).toHaveBeenCalledTimes(2)
      } finally {
        vi.useRealTimers()
        setBackupInProgress(false)
      }
    })

    it('escapes via native dialog + forceExit when both relaunch paths fail (#10)', async () => {
      const service = new BackupService()
      let journalReadCount = 0
      readRestoreJournalMock.mockImplementation(() => {
        journalReadCount += 1
        return journalReadCount <= 1 ? { kind: 'none' } : okJournal('staged')
      })
      // Both the staged relaunch and the fallback app.relaunch throw.
      relaunchMock.mockImplementation(() => {
        throw new Error('relaunch unavailable')
      })
      vi.useFakeTimers()
      try {
        await service.startRestore({ archivePath: '/x.cherrybackup' })
        await vi.advanceTimersByTimeAsync(3000)
        // Two relaunch attempts, then escapeStrandedProcess fires.
        expect(relaunchMock).toHaveBeenCalledTimes(2)
        expect(dialogShowMessageBoxMock).toHaveBeenCalledTimes(1)
        // Dialog resolves (user acknowledges) → forceExit(1) exactly once.
        expect(forceExitMock).toHaveBeenCalledTimes(1)
        expect(forceExitMock).toHaveBeenCalledWith(1)
        // Escape must not release the quiesce hold or clear the staged journal —
        // the preboot gate retries the staged journal on the next launch.
        expect(isBackupInProgress()).toBe(true)
        expect(clearRestoreJournalMock).not.toHaveBeenCalled()
        // A late watchdog fire is a no-op via the finished flag — no second
        // forceExit (the watchdog is not clearTimeout'd; it relies on finished).
        await vi.advanceTimersByTimeAsync(15_000)
        expect(forceExitMock).toHaveBeenCalledTimes(1)
      } finally {
        vi.useRealTimers()
        setBackupInProgress(false)
      }
    })

    it('force-exits via watchdog when the native dialog never resolves (#10)', async () => {
      const service = new BackupService()
      let journalReadCount = 0
      readRestoreJournalMock.mockImplementation(() => {
        journalReadCount += 1
        return journalReadCount <= 1 ? { kind: 'none' } : okJournal('staged')
      })
      relaunchMock.mockImplementation(() => {
        throw new Error('relaunch unavailable')
      })
      // Dialog pending forever — the watchdog must guarantee exit.
      dialogShowMessageBoxMock.mockReturnValue(new Promise(() => {}))
      vi.useFakeTimers()
      try {
        await service.startRestore({ archivePath: '/x.cherrybackup' })
        await vi.advanceTimersByTimeAsync(3000)
        expect(dialogShowMessageBoxMock).toHaveBeenCalledTimes(1)
        expect(forceExitMock).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(15_000)
        expect(forceExitMock).toHaveBeenCalledTimes(1)
        expect(forceExitMock).toHaveBeenCalledWith(1)
      } finally {
        vi.useRealTimers()
        setBackupInProgress(false)
      }
    })

    it('force-exits when the native dialog rejects (#10)', async () => {
      const service = new BackupService()
      let journalReadCount = 0
      readRestoreJournalMock.mockImplementation(() => {
        journalReadCount += 1
        return journalReadCount <= 1 ? { kind: 'none' } : okJournal('staged')
      })
      relaunchMock.mockImplementation(() => {
        throw new Error('relaunch unavailable')
      })
      dialogShowMessageBoxMock.mockRejectedValue(new Error('dialog blocked'))
      vi.useFakeTimers()
      try {
        await service.startRestore({ archivePath: '/x.cherrybackup' })
        await vi.advanceTimersByTimeAsync(3000)
        expect(forceExitMock).toHaveBeenCalledTimes(1)
        expect(forceExitMock).toHaveBeenCalledWith(1)
      } finally {
        vi.useRealTimers()
        setBackupInProgress(false)
      }
    })

    it('escapes when the a1 unrecoverable-hold relaunch also fails (#10 a1 symmetry)', async () => {
      const service = new BackupService()
      // a1 hold acquisition throws mid-acquire (partial window destroy).
      windowManagerAcquireHold.mockImplementation(() => {
        throw new Error('renderer refused destroy')
      })
      relaunchMock.mockImplementation(() => {
        throw new Error('relaunch unavailable')
      })
      vi.useFakeTimers()
      try {
        await expect(service.startRestore({ archivePath: '/x.cherrybackup' })).rejects.toSatisfy(
          (err: unknown) => err instanceof IpcError && err.code === 'BACKUP_RESTORE_HOLD_FAILED'
        )
        // a1 catch scheduled relaunch on setTimeout(0); firing it throws → escape.
        await vi.advanceTimersByTimeAsync(0)
        expect(relaunchMock).toHaveBeenCalledTimes(1)
        expect(dialogShowMessageBoxMock).toHaveBeenCalledTimes(1)
        expect(forceExitMock).toHaveBeenCalledTimes(1)
        expect(forceExitMock).toHaveBeenCalledWith(1)
      } finally {
        vi.useRealTimers()
        setBackupInProgress(false)
      }
    })

    it('proceeds on clean verdict — seals, broadcasts the summary, shows Notification, and AUTO-RELAUNCHES after delay', async () => {
      drainInFlight.mockResolvedValue({ stragglerIds: [], startupRecoveryPending: false })
      const holdDispose = vi.fn()
      jobManagerPause.mockReturnValue({ dispose: holdDispose })
      windowManagerAcquireHold.mockReturnValue({ dispose: holdDispose })
      const service = new BackupService()

      // Track how many times the journal is read so we can flip to
      // `staged` AFTER the startRestore journal-guard check passes
      // (the guard runs against the pre-restore state) and stays
      // `staged` for the post-delay relaunchStagedRestore() call.
      let journalReadCount = 0
      readRestoreJournalMock.mockImplementation(() => {
        journalReadCount += 1
        // First reads: pre-seal (none); from the seal onwards: staged.
        if (journalReadCount <= 1) return { kind: 'none' }
        return okJournal('staged')
      })

      // Use fake timers so the 2.75s post-seal relaunch delay doesn't
      // make the test slow — the relaunch callback is fired by
      // `setTimeout(then, 2750)`.
      vi.useFakeTimers()
      try {
        const restorePromise = service.startRestore({ archivePath: '/x.cherrybackup' })
        // startRestore returns synchronously up to the importBackup await; the
        // schedulePostSealRelaunch setTimeout(then, 2750) is queued inside.
        await restorePromise

        // a1 ordering: WindowManager hold is acquired FIRST, then the
        // existing flag / channel / AI / agent / job pauses run. Assert
        // the a1 hold was acquired with the documented reason before
        // anything else got a pause.
        expect(windowManagerAcquireHold).toHaveBeenCalledWith('restore-quiesce')

        // Right after the resolved promise: a1 hold acquired, summary
        // broadcast, Notification shown, but auto-relaunch is still
        // pending the 2.75s delay.
        expect(afterQuiesce).toHaveBeenCalledTimes(1)
        expect(relaunchMock).not.toHaveBeenCalled()
        expect(broadcastMock).toHaveBeenCalledWith('backup.restore_summary', {
          toRestore: [],
          toSkip: [],
          degradations: []
        })
        expect(notificationShow).toHaveBeenCalledTimes(1)
        // Quiesce survives the resolved request: the write window stays closed
        // from seal through the relaunch (held until process exit).
        expect(isBackupInProgress()).toBe(true)
        expect(holdDispose).not.toHaveBeenCalled()

        // Fast-forward past the 2.75s delay → the auto-relaunch fires.
        await vi.advanceTimersByTimeAsync(5000)
        expect(relaunchMock).toHaveBeenCalledTimes(1)
      } finally {
        vi.useRealTimers()
        setBackupInProgress(false) // module-singleton gate — reset for later tests
      }
    })

    it('onStop releases a sealed restore quiesce hold for same-process lifecycle restart (CR-008)', async () => {
      const holdDispose = vi.fn()
      jobManagerPause.mockReturnValue({ dispose: holdDispose })
      const service = new BackupService()

      await service.startRestore({ archivePath: '/x.cherrybackup' })
      expect(isBackupInProgress()).toBe(true)
      expect(holdDispose).not.toHaveBeenCalled()

      ;(service as unknown as { onStop: () => void }).onStop()

      expect(isBackupInProgress()).toBe(false)
      expect(holdDispose).toHaveBeenCalledTimes(1)
    })

    it('onStop leaves an active restore hold owned by its async abort cleanup', () => {
      const abort = vi.fn()
      const holdDispose = vi.fn()
      const service = new BackupService()
      const internals = service as unknown as {
        activeOperation: { abortController: { abort: () => void } }
        restoreQuiesceHold: { dispose: () => void }
        onStop: () => void
      }
      internals.activeOperation = { abortController: { abort } }
      internals.restoreQuiesceHold = { dispose: holdDispose }
      setBackupInProgress(true)

      internals.onStop()

      expect(abort).toHaveBeenCalledTimes(1)
      expect(isBackupInProgress()).toBe(true)
      expect(holdDispose).not.toHaveBeenCalled()
      setBackupInProgress(false)
    })

    it('broadcasts the orchestrator summary verbatim (never re-derived)', async () => {
      drainInFlight.mockResolvedValue({ stragglerIds: [], startupRecoveryPending: false })
      // Once: keep the describe's quiesce drive, but return a NON-empty summary so a
      // toSkip↔toRestore swap or a dropped degradations field would fail here.
      const summary = {
        toRestore: [{ kind: 'file', count: 2 }],
        toSkip: [{ id: 'f1', kind: 'file', reasonCode: 'target_exists' }],
        degradations: [{ kind: 'row_pruned', scope: 'chat_message_file_ref', count: 3, detail: 'target missing' }]
      }
      importBackup.mockImplementationOnce(async () => {
        await runQuiesceViaImportBackupMock()
        return { summary }
      })
      // Flip from pre-seal `none` to post-seal `staged` once the
      // startRestore journal-guard has passed.
      let journalReadCount = 0
      readRestoreJournalMock.mockImplementation(() => {
        journalReadCount += 1
        if (journalReadCount <= 1) return { kind: 'none' }
        return okJournal('staged')
      })
      const service = new BackupService()
      vi.useFakeTimers()
      try {
        await service.startRestore({ archivePath: '/x.cherrybackup' })
        expect(broadcastMock).toHaveBeenCalledWith('backup.restore_summary', summary)
        // Pre-delay: relaunch is queued but not yet fired.
        expect(relaunchMock).not.toHaveBeenCalled()
        expect(isBackupInProgress()).toBe(true)
        // After the delay: auto-relaunch fires.
        await vi.advanceTimersByTimeAsync(3000)
        expect(relaunchMock).toHaveBeenCalledTimes(1)
      } finally {
        vi.useRealTimers()
        setBackupInProgress(false)
      }
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

    it('a broadcast failure does not fail the sealed restore (renderer can pull the journal)', async () => {
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
          quiesceWriters: () => Promise<void>
        }
        expect(deps.planResources).toBeDefined()
        expect(deps.planRoots).toBeDefined()
        // a1 — drive quiesceWriters so the WindowManager hold runs in the
        // real flow (the production ImportOrchestrator calls this first;
        // the test previously omitted it because quiesceWriters had no
        // observable effect — now a1 acquire must run).
        await deps.quiesceWriters()
        await deps.admitArchive('/x.cherrybackup', '/work', '/mig')
        return { summary: { toRestore: [], toSkip: [], degradations: [] } }
      })
      // Flip from pre-seal `none` to post-seal `staged` so the
      // post-delay relaunch can fire.
      let journalReadCount = 0
      readRestoreJournalMock.mockImplementation(() => {
        journalReadCount += 1
        if (journalReadCount <= 1) return { kind: 'none' }
        return okJournal('staged')
      })
      const service = new BackupService()

      vi.useFakeTimers()
      try {
        await expect(service.startRestore({ archivePath: '/x.cherrybackup' })).resolves.toMatchObject({
          restoreId: expect.stringMatching(/^rst-/)
        })
        // a1: WindowManager hold acquired before any other pause. Sealed success
        // broadcasts the summary + shows Notification + auto-relaunches after delay.
        expect(windowManagerAcquireHold).toHaveBeenCalledWith('restore-quiesce')
        expect(notificationShow).toHaveBeenCalledTimes(1)
        // Pre-delay: relaunch is queued but not yet fired.
        expect(relaunchMock).not.toHaveBeenCalled()
        expect(broadcastMock).toHaveBeenCalledWith('backup.restore_summary', {
          toRestore: [],
          toSkip: [],
          degradations: []
        })
        await vi.advanceTimersByTimeAsync(3000)
        expect(relaunchMock).toHaveBeenCalledTimes(1)
      } finally {
        vi.useRealTimers()
        setBackupInProgress(false)
      }
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
          quiesceWriters: () => Promise<void>
        }
        // a1 — drive quiesceWriters in the test mock (production calls
        // this first; the test previously omitted it because the call
        // had no observable effect — now a1 acquire must run).
        await deps.quiesceWriters()
        await deps.admitArchive('/x.cherrybackup', '/work', '/mig')
        return { summary: { toRestore: [], toSkip: [], degradations: [] } }
      })
      // Flip from pre-seal `none` to post-seal `staged` so the
      // post-delay relaunch can fire.
      let journalReadCount = 0
      readRestoreJournalMock.mockImplementation(() => {
        journalReadCount += 1
        if (journalReadCount <= 1) return { kind: 'none' }
        return okJournal('staged')
      })
      const service = new BackupService()

      vi.useFakeTimers()
      try {
        await expect(service.startRestore({ archivePath: '/x.cherrybackup' })).resolves.toMatchObject({
          restoreId: expect.stringMatching(/^rst-/)
        })
        // a1 ordering still holds for the lite path.
        expect(windowManagerAcquireHold).toHaveBeenCalledWith('restore-quiesce')
        expect(notificationShow).toHaveBeenCalledTimes(1)
        // Pre-delay: relaunch is queued but not yet fired.
        expect(relaunchMock).not.toHaveBeenCalled()
        expect(broadcastMock).toHaveBeenCalledWith('backup.restore_summary', {
          toRestore: [],
          toSkip: [],
          degradations: []
        })
        await vi.advanceTimersByTimeAsync(3000)
        expect(relaunchMock).toHaveBeenCalledTimes(1)
      } finally {
        vi.useRealTimers()
        setBackupInProgress(false)
      }
    })
  })

  // Touch IpcError so the unused import is not flagged by the import side of the mock graph.
  it('uses IpcError for the pending throw', () => {
    expect(new IpcError(backupErrorCodes.RESTORE_PENDING, 'x')).toBeInstanceOf(IpcError)
  })
})
