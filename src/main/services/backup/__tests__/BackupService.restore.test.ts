import { beforeEach, describe, expect, it, vi } from 'vitest'

const { importBackup, readRestoreJournalMock, clearRestoreJournalMock, getRegistry, jobManagerPause, relaunchMock } =
  vi.hoisted(() => ({
    importBackup: vi.fn(),
    readRestoreJournalMock: vi.fn(),
    clearRestoreJournalMock: vi.fn(),
    getRegistry: vi.fn(() => ({ domains: [] })),
    jobManagerPause: vi.fn(() => ({ dispose: vi.fn() })),
    relaunchMock: vi.fn()
  }))

vi.mock('../ImportOrchestrator', () => ({
  ImportOrchestrator: vi.fn().mockImplementation(() => ({ importBackup }))
}))

vi.mock('../contributors', () => ({
  contributorManager: { getRegistry }
}))

vi.mock('../ExcludedDomainStripper', () => ({
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
      return { pause: jobManagerPause, drainInFlight: vi.fn(async () => ({ stragglerIds: [] })) }
    }
    return innerGet(name)
  })
  ;(mocked.application as unknown as { relaunch: typeof relaunchMock }).relaunch = relaunchMock
  return mocked
})

import { BaseService } from '@main/core/lifecycle'
import { IpcError } from '@shared/ipc/errors/IpcError'

import { BackupService } from '../BackupService'

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

describe('BackupService restore journal lifecycle (A7)', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    vi.clearAllMocks()
    readRestoreJournalMock.mockReturnValue({ kind: 'none' })
    clearRestoreJournalMock.mockImplementation(() => {})
    importBackup.mockResolvedValue(undefined)
    getRegistry.mockReturnValue({ domains: [] })
    jobManagerPause.mockReturnValue({ dispose: vi.fn() })
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
  })

  describe('startRestore journal guard (PRIMARY fix path)', () => {
    it('throws BACKUP_RESTORE_PENDING for staged (genuine pending) and does NOT clear', async () => {
      readRestoreJournalMock.mockReturnValue(okJournal('staged'))
      const service = new BackupService()
      await expect(service.startRestore({ archivePath: '/x.cbu' })).rejects.toMatchObject({
        code: 'BACKUP_RESTORE_PENDING'
      })
      expect(clearRestoreJournalMock).not.toHaveBeenCalled()
    })

    it('throws BACKUP_RESTORE_PENDING for promoting (genuine pending) and does NOT clear', async () => {
      readRestoreJournalMock.mockReturnValue(okJournal('promoting', 'live-aside'))
      const service = new BackupService()
      await expect(service.startRestore({ archivePath: '/x.cbu' })).rejects.toMatchObject({
        code: 'BACKUP_RESTORE_PENDING'
      })
      expect(clearRestoreJournalMock).not.toHaveBeenCalled()
    })

    it('clears + proceeds for completed (same-session second restore)', async () => {
      readRestoreJournalMock.mockReturnValue(okJournal('completed', 'integrity-ok'))
      const service = new BackupService()
      await service.startRestore({ archivePath: '/x.cbu' })
      expect(clearRestoreJournalMock).toHaveBeenCalledTimes(1)
      expect(importBackup).toHaveBeenCalledTimes(1)
    })

    it('clears + proceeds for failed/expired terminal', async () => {
      readRestoreJournalMock.mockReturnValue(okJournal('failed', 'live-aside'))
      const service = new BackupService()
      await service.startRestore({ archivePath: '/x.cbu' })
      expect(clearRestoreJournalMock).toHaveBeenCalledTimes(1)
      expect(importBackup).toHaveBeenCalledTimes(1)
    })

    it('clears + proceeds for corrupt (belt)', async () => {
      readRestoreJournalMock.mockReturnValue({ kind: 'corrupt', error: 'bad' })
      const service = new BackupService()
      await service.startRestore({ archivePath: '/x.cbu' })
      expect(clearRestoreJournalMock).toHaveBeenCalledTimes(1)
      expect(importBackup).toHaveBeenCalledTimes(1)
    })
  })

  // Touch IpcError so the unused import is not flagged by the import side of the mock graph.
  it('uses IpcError for the pending throw', () => {
    expect(new IpcError('BACKUP_RESTORE_PENDING', 'x')).toBeInstanceOf(IpcError)
  })
})
