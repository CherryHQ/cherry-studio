import { beforeEach, describe, it, expect, vi } from 'vitest'

vi.mock('@main/data/db/restore/hashDbFile', () => ({
  hashDbFile: vi.fn()
}))

import { hashDbFile } from '@main/data/db/restore/hashDbFile'
import { captureLiveFingerprint } from '../fingerprintProducer'

describe('captureLiveFingerprint', () => {
  // Reset mock call history + implementation between tests so each test's
  // assertions are independent (no global clearMocks in vitest config).
  beforeEach(() => {
    vi.resetAllMocks()
  })
  it('runs checkpointTruncate then hashDbFile and returns the hash', async () => {
    // Arrange — stub DbService with only the method under test
    const checkpointTruncate = vi.fn()
    const dbService = { checkpointTruncate } as never
    vi.mocked(hashDbFile).mockResolvedValue('deadbeef')

    // Act
    const result = await captureLiveFingerprint(dbService, '/tmp/live.sqlite')

    // Assert — checkpoint runs first (folds WAL), then hash reads the main file
    expect(checkpointTruncate).toHaveBeenCalledOnce()
    expect(hashDbFile).toHaveBeenCalledWith('/tmp/live.sqlite')
    expect(result).toBe('deadbeef')
  })

  it('propagates checkpointTruncate assert failure (busy!=0 → quiesce leak, fail-closed)', async () => {
    // Arrange — checkpoint throws (busy!=0: quiesce leak / foreign connection)
    const checkpointTruncate = vi.fn(() => {
      throw new Error('wal_checkpoint TRUNCATE failed: busy=1')
    })
    const dbService = { checkpointTruncate } as never

    // Act + Assert — abort before hashDbFile (no fingerprint on a dirty state)
    await expect(captureLiveFingerprint(dbService, '/tmp/live.sqlite')).rejects.toThrow(/busy/)
    expect(hashDbFile).not.toHaveBeenCalled()
  })
})
