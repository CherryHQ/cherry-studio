import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Shell contract only (the promotion logic and the crash net's journal/aside
 * behavior are covered by restorePromotion.test.ts): the gate NEVER throws —
 * a preboot exception would land in startApp's fail-fast catch and dead-loop
 * "Unable to Start" — and on an unexpected substance crash it hands cleanup
 * to markRestoreFailedAfterCrash.
 */

const runRestorePromotionMock = vi.fn<() => Promise<void>>()
const markRestoreFailedAfterCrashMock = vi.fn<() => void>()

vi.mock('@data/db/restore/restorePromotion', () => ({
  runRestorePromotion: () => runRestorePromotionMock(),
  markRestoreFailedAfterCrash: () => markRestoreFailedAfterCrashMock()
}))

import { runBackupRestoreGate } from '../backupRestoreGate'

beforeEach(() => {
  runRestorePromotionMock.mockReset()
  markRestoreFailedAfterCrashMock.mockReset()
})

describe('runBackupRestoreGate', () => {
  it('delegates to the promotion logic and skips the crash net on success', async () => {
    runRestorePromotionMock.mockResolvedValue(undefined)

    await expect(runBackupRestoreGate()).resolves.toBeUndefined()

    expect(runRestorePromotionMock).toHaveBeenCalledOnce()
    expect(markRestoreFailedAfterCrashMock).not.toHaveBeenCalled()
  })

  it('swallows a substance crash and invokes the crash net', async () => {
    runRestorePromotionMock.mockRejectedValue(new Error('boom'))

    await expect(runBackupRestoreGate()).resolves.toBeUndefined()

    expect(markRestoreFailedAfterCrashMock).toHaveBeenCalledOnce()
  })

  it('never throws even when the crash net itself fails', async () => {
    runRestorePromotionMock.mockRejectedValue(new Error('boom'))
    markRestoreFailedAfterCrashMock.mockImplementation(() => {
      throw new Error('disk full')
    })

    await expect(runBackupRestoreGate()).resolves.toBeUndefined()
  })
})
