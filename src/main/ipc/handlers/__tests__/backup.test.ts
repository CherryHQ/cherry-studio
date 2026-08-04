import { beforeEach, describe, expect, it, vi } from 'vitest'

const { applicationGet, recordManualBackupCompletion } = vi.hoisted(() => ({
  applicationGet: vi.fn(),
  recordManualBackupCompletion: vi.fn()
}))

vi.mock('@application', () => ({ application: { get: applicationGet } }))

import { backupHandlers } from '../backup'

beforeEach(() => {
  vi.clearAllMocks()
  applicationGet.mockReturnValue({ recordManualBackupCompletion })
})

describe('backupHandlers', () => {
  it('records manual backup completion in the automatic backup service', async () => {
    await backupHandlers['backup.manual_completion.record']({ type: 'nutstore' }, { senderId: 'main' })

    expect(recordManualBackupCompletion).toHaveBeenCalledExactlyOnceWith('nutstore')
  })
})
