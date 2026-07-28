import { IpcError } from '@shared/ipc/errors/IpcError'
import { afterEach, describe, expect, it } from 'vitest'

import { assertNotBackupInProgress, isBackupInProgress, setBackupInProgress } from '../quiesceGate'

describe('quiesceGate', () => {
  afterEach(() => {
    setBackupInProgress(false)
  })

  it('setBackupInProgress(true) makes isBackupInProgress true and assert throws', () => {
    setBackupInProgress(true)
    expect(isBackupInProgress()).toBe(true)
    expect(() => assertNotBackupInProgress()).toThrow(IpcError)
    try {
      assertNotBackupInProgress()
    } catch (e) {
      expect(e).toMatchObject({ code: 'BACKUP_IN_PROGRESS' })
    }
  })

  it('setBackupInProgress(false) clears the gate so assert passes', () => {
    setBackupInProgress(true)
    setBackupInProgress(false)
    expect(isBackupInProgress()).toBe(false)
    expect(() => assertNotBackupInProgress()).not.toThrow()
  })
})
