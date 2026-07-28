import { beforeEach, describe, expect, it, vi } from 'vitest'

const { formatVersion, readV1, v1, v2 } = vi.hoisted(() => ({
  formatVersion: vi.fn<() => 1 | 2 | 'none' | 'unknown'>(),
  readV1: vi.fn(),
  v1: {
    run: vi.fn<() => Promise<void>>(),
    mark: vi.fn<() => void>(),
    stranded: vi.fn<() => boolean>(),
    pending: vi.fn<() => boolean>(),
    cleanup: vi.fn<() => void>()
  },
  v2: {
    run: vi.fn<() => Promise<void>>(),
    mark: vi.fn<() => void>(),
    stranded: vi.fn<() => boolean>(),
    pending: vi.fn<() => boolean>()
  }
}))

vi.mock('@data/db/restore/restoreJournal', () => ({ readRestoreJournalFormatVersion: formatVersion }))
vi.mock('@data/db/restore/restoreJournalV1Compat', () => ({ readRestoreJournal: readV1 }))
vi.mock('@data/db/restore/restorePromotionV1Compat', () => ({
  runRestorePromotion: v1.run,
  markRestoreFailedAfterCrash: v1.mark,
  isLiveDbStranded: v1.stranded,
  isRestoreRecoveryPending: v1.pending,
  cleanupTerminalRestoreArtifacts: v1.cleanup
}))
vi.mock('@data/db/restore/restorePromotion', () => ({
  runRestorePromotion: v2.run,
  markRestoreFailedAfterCrash: v2.mark,
  isLiveDbStranded: v2.stranded,
  isRestoreRecoveryPending: v2.pending
}))

import { runBackupRestoreGate } from '../backupRestoreGate'

beforeEach(() => {
  formatVersion.mockReset().mockReturnValue(2)
  readV1.mockReset().mockReturnValue({ kind: 'ok', journal: {} })
  for (const executor of [v1, v2]) {
    executor.run.mockReset().mockResolvedValue(undefined)
    executor.mark.mockReset()
    executor.stranded.mockReset().mockReturnValue(false)
    executor.pending.mockReset().mockReturnValue(false)
  }
  v1.cleanup.mockReset()
})

describe('runBackupRestoreGate', () => {
  it('runs only the final Lite executor for version 2 journals', async () => {
    await expect(runBackupRestoreGate()).resolves.toBeUndefined()

    expect(v2.run).toHaveBeenCalledOnce()
    expect(v1.run).not.toHaveBeenCalled()
    expect(v1.cleanup).not.toHaveBeenCalled()
  })

  it('runs the v1 executor through terminal cleanup for a valid RC1 journal', async () => {
    formatVersion.mockReturnValue(1)

    await expect(runBackupRestoreGate()).resolves.toBeUndefined()

    expect(readV1).toHaveBeenCalledOnce()
    expect(v1.run).toHaveBeenCalledOnce()
    expect(v1.cleanup).toHaveBeenCalledOnce()
    expect(v2.run).not.toHaveBeenCalled()
  })

  it('refuses corrupt or future evidence before either executor can mutate it', async () => {
    formatVersion.mockReturnValue('unknown')

    await expect(runBackupRestoreGate()).rejects.toThrow(/unsupported or corrupt/)

    expect(v1.run).not.toHaveBeenCalled()
    expect(v2.run).not.toHaveBeenCalled()
  })

  it('refuses a malformed version-1 journal before the compatibility executor can mutate it', async () => {
    formatVersion.mockReturnValue(1)
    readV1.mockReturnValue({ kind: 'corrupt', error: 'invalid v1 schema' })

    await expect(runBackupRestoreGate()).rejects.toThrow(/unsupported or corrupt/)

    expect(v1.run).not.toHaveBeenCalled()
    expect(v2.run).not.toHaveBeenCalled()
  })

  it('refuses to boot when v1 cleanup cannot remove its terminal evidence', async () => {
    formatVersion.mockReturnValue(1)
    v1.cleanup.mockImplementation(() => {
      throw new Error('EACCES')
    })

    await expect(runBackupRestoreGate()).rejects.toThrow(/EACCES/)
    expect(v1.cleanup).toHaveBeenCalledOnce()
  })

  it('refuses an empty or mixed state after escaped recovery', async () => {
    v2.run.mockRejectedValueOnce(new Error('boom'))
    v2.stranded.mockReturnValueOnce(true)
    await expect(runBackupRestoreGate()).rejects.toThrow(/empty database/)
    expect(v2.mark).toHaveBeenCalledOnce()

    v2.run.mockRejectedValueOnce(new Error('boom'))
    v2.pending.mockReturnValueOnce(true)
    await expect(runBackupRestoreGate()).rejects.toThrow(/mixed restore state/)
  })
})
