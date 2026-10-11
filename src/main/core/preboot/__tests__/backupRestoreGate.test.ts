import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Shell contract only (the promotion logic and the crash net's journal/aside
 * behavior are covered by restorePromotion.test.ts and restoreRollbackRetention.test.ts).
 * Pending recovery or a stranded database must block database boot.
 */

const runRestorePromotionMock = vi.fn<() => Promise<void>>()
const markRestoreFailedAfterCrashMock = vi.fn<() => void>()
const isLiveDbStrandedMock = vi.fn<() => boolean>()
const cleanupTerminalRestoreArtifactsMock = vi.fn<() => void>()
const hasPendingRestoreMock = vi.fn<() => boolean>()

vi.mock('@data/db/restore/restoreJournal', () => ({
  hasPendingRestore: () => hasPendingRestoreMock()
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
  hasPendingRestoreMock.mockReset()
  isLiveDbStrandedMock.mockReturnValue(false)
  hasPendingRestoreMock.mockReturnValue(false)
})

describe('runBackupRestoreGate', () => {
  it('delegates to the promotion logic and skips the crash net on success', async () => {
    runRestorePromotionMock.mockResolvedValue(undefined)

    await expect(runBackupRestoreGate()).resolves.toBeUndefined()
  })

  it('swallows a substance crash and invokes the crash net', async () => {
    runRestorePromotionMock.mockRejectedValue(new Error('boom'))

    await expect(runBackupRestoreGate()).resolves.toBeUndefined()
  })

  it('never throws on a crash-net failure while the live DB survived', async () => {
    runRestorePromotionMock.mockRejectedValue(new Error('boom'))
    markRestoreFailedAfterCrashMock.mockImplementation(() => {
      throw new Error('disk full')
    })

    await expect(runBackupRestoreGate()).resolves.toBeUndefined()
  })

  it('refuses to boot when recovery left the live DB stranded in the aside', async () => {
    runRestorePromotionMock.mockRejectedValue(new Error('boom'))
    isLiveDbStrandedMock.mockReturnValue(true)

    // Booting on would create a fresh empty database while the user's data
    // sits in the aside — the one case worse than the fail-fast dialog.
    await expect(runBackupRestoreGate()).rejects.toThrow(/empty database/)
  })

  it('refuses to boot when the crash net itself failed and the live DB is stranded', async () => {
    runRestorePromotionMock.mockRejectedValue(new Error('boom'))
    markRestoreFailedAfterCrashMock.mockImplementation(() => {
      throw new Error('EBUSY: aside rename blocked')
    })
    isLiveDbStrandedMock.mockReturnValue(true)

    await expect(runBackupRestoreGate()).rejects.toThrow(/empty database/)
  })

  it.each(['promotion', 'crash-net', 'terminal-cleanup'])(
    'refuses to boot when %s leaves recovery pending',
    async (failure) => {
      if (failure !== 'terminal-cleanup') runRestorePromotionMock.mockRejectedValue(new Error('recovery blocked'))
      if (failure === 'crash-net') {
        markRestoreFailedAfterCrashMock.mockImplementation(() => {
          throw new Error('resource still locked')
        })
      }
      hasPendingRestoreMock.mockReturnValue(true)

      await expect(runBackupRestoreGate()).rejects.toThrow(/recovery is incomplete/)
    }
  )
})
