import { beforeEach, describe, expect, it, vi } from 'vitest'

const { run, mark, stranded, pending } = vi.hoisted(() => ({
  run: vi.fn<() => Promise<void>>(),
  mark: vi.fn<() => void>(),
  stranded: vi.fn<() => boolean>(),
  pending: vi.fn<() => boolean>()
}))
vi.mock('@data/db/restore/restorePromotion', () => ({
  runRestorePromotion: run,
  markRestoreFailedAfterCrash: mark,
  isLiveDbStranded: stranded,
  isRestoreRecoveryPending: pending
}))

import { runBackupRestoreGate } from '../backupRestoreGate'

beforeEach(() => {
  run.mockReset().mockResolvedValue(undefined)
  mark.mockReset()
  stranded.mockReset().mockReturnValue(false)
  pending.mockReset().mockReturnValue(false)
})

describe('runBackupRestoreGate', () => {
  it('does nothing after a coherent promotion', async () => {
    await expect(runBackupRestoreGate()).resolves.toBeUndefined()
    expect(mark).not.toHaveBeenCalled()
  })

  it('refuses an empty or mixed state after escaped recovery', async () => {
    run.mockRejectedValueOnce(new Error('boom'))
    stranded.mockReturnValueOnce(true)
    await expect(runBackupRestoreGate()).rejects.toThrow(/empty database/)
    expect(mark).toHaveBeenCalledOnce()

    run.mockRejectedValueOnce(new Error('boom'))
    pending.mockReturnValueOnce(true)
    await expect(runBackupRestoreGate()).rejects.toThrow(/mixed restore state/)
  })
})
