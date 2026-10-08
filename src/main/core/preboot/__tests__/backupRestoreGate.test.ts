import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { readRestoreJournal } from '@data/db/restore/restoreJournal'

/**
 * Shell contract only (the promotion logic and the crash net's journal/aside
 * behavior are covered by restorePromotion.test.ts): the gate never throws —
 * a preboot exception lands in startApp's fail-fast catch — with exactly one
 * exception: when recovery left no live DB while the aside still holds the
 * user's data, booting on would CREATE a fresh empty database, so the gate
 * must refuse and fail fast instead.
 */

const runRestorePromotionMock = vi.fn<() => Promise<void>>()
const markRestoreFailedAfterCrashMock = vi.fn<() => void>()
const isLiveDbStrandedMock = vi.fn<() => boolean>()
const cleanupTerminalRestoreArtifactsMock = vi.fn<() => void>()
const readRestoreJournalMock = vi.fn<typeof readRestoreJournal>()
const showErrorBoxMock = vi.fn()

vi.mock('@data/db/restore/restoreJournal', () => ({ readRestoreJournal: () => readRestoreJournalMock() }))
vi.mock('electron', () => ({
  app: { whenReady: vi.fn().mockResolvedValue(undefined), getLocale: () => 'en-US' },
  dialog: { showErrorBox: (...args: unknown[]) => showErrorBoxMock(...args) }
}))

vi.mock('@data/db/restore/restorePromotion', () => ({
  runRestorePromotion: () => runRestorePromotionMock(),
  markRestoreFailedAfterCrash: () => markRestoreFailedAfterCrashMock(),
  isLiveDbStranded: () => isLiveDbStrandedMock(),
  cleanupTerminalRestoreArtifacts: () => cleanupTerminalRestoreArtifactsMock()
}))

import { runBackupRestoreGate } from '../backupRestoreGate'

beforeEach(() => {
  runRestorePromotionMock.mockReset()
  markRestoreFailedAfterCrashMock.mockReset()
  isLiveDbStrandedMock.mockReset()
  cleanupTerminalRestoreArtifactsMock.mockReset()
  isLiveDbStrandedMock.mockReturnValue(false)
  readRestoreJournalMock.mockReturnValue({ kind: 'none' })
  showErrorBoxMock.mockClear()
})

describe('runBackupRestoreGate', () => {
  it.each(['failed', 'expired'] as const)('reports a %s restore before its journal is consumed', async (state) => {
    readRestoreJournalMock.mockReturnValue({
      kind: 'ok',
      journal: { state } as Extract<ReturnType<typeof readRestoreJournal>, { kind: 'ok' }>['journal']
    })
    cleanupTerminalRestoreArtifactsMock.mockImplementation(() => {
      expect(showErrorBoxMock).toHaveBeenCalledWith(
        'Restore failed',
        expect.stringContaining('Your previous data has been kept')
      )
    })

    await expect(runBackupRestoreGate()).resolves.toBeUndefined()
    expect(showErrorBoxMock).toHaveBeenCalledOnce()
  })

  it('delegates to the promotion logic and skips the crash net on success', async () => {
    runRestorePromotionMock.mockResolvedValue(undefined)

    await expect(runBackupRestoreGate()).resolves.toBeUndefined()

    expect(showErrorBoxMock).not.toHaveBeenCalled()
  })

  it('swallows a substance crash and invokes the crash net', async () => {
    runRestorePromotionMock.mockRejectedValue(new Error('boom'))

    await expect(runBackupRestoreGate()).resolves.toBeUndefined()

    expect(markRestoreFailedAfterCrashMock).toHaveBeenCalledOnce()
    expect(cleanupTerminalRestoreArtifactsMock).toHaveBeenCalledOnce()
  })

  it('never throws on a crash-net failure while the live DB survived', async () => {
    runRestorePromotionMock.mockRejectedValue(new Error('boom'))
    markRestoreFailedAfterCrashMock.mockImplementation(() => {
      throw new Error('disk full')
    })

    await expect(runBackupRestoreGate()).resolves.toBeUndefined()
    expect(cleanupTerminalRestoreArtifactsMock).toHaveBeenCalledOnce()
  })

  it('refuses to boot when recovery left the live DB stranded in the aside', async () => {
    runRestorePromotionMock.mockRejectedValue(new Error('boom'))
    isLiveDbStrandedMock.mockReturnValue(true)

    // Booting on would create a fresh empty database while the user's data
    // sits in the aside — the one case worse than the fail-fast dialog.
    await expect(runBackupRestoreGate()).rejects.toThrow(/empty database/)
    expect(cleanupTerminalRestoreArtifactsMock).not.toHaveBeenCalled()
  })

  it('refuses to boot when the crash net itself failed and the live DB is stranded', async () => {
    runRestorePromotionMock.mockRejectedValue(new Error('boom'))
    markRestoreFailedAfterCrashMock.mockImplementation(() => {
      throw new Error('EBUSY: aside rename blocked')
    })
    isLiveDbStrandedMock.mockReturnValue(true)

    await expect(runBackupRestoreGate()).rejects.toThrow(/empty database/)
    expect(cleanupTerminalRestoreArtifactsMock).not.toHaveBeenCalled()
  })
})
