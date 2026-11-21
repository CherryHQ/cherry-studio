import { beforeEach, describe, expect, it } from 'vitest'

import { IpcError } from '@shared/ipc/errors/IpcError'
import { notesRelocationErrorCodes } from '@shared/ipc/errors/notesRelocation'

import {
  abandonNotesRelocationSession,
  acquireNotesRelocationSession,
  isNotesRelocationBarrierActive,
  releaseNotesRelocationSession,
  resetNotesRelocationSessionForTests,
  setNotesRelocationMigrateInFlight
} from '../notesRelocationSession'

describe('notesRelocationSession', () => {
  beforeEach(() => {
    resetNotesRelocationSessionForTests()
  })
  it('rejects a second migration while the first session is active', () => {
    const firstEpoch = acquireNotesRelocationSession('window-a')

    expect(() => acquireNotesRelocationSession('window-b')).toThrow(
      expect.objectContaining({
        code: notesRelocationErrorCodes.NOTES_RELOCATION_IN_PROGRESS
      })
    )

    expect(releaseNotesRelocationSession('window-a', firstEpoch)).toBe(true)
    const secondEpoch = acquireNotesRelocationSession('window-b')
    expect(releaseNotesRelocationSession('window-b', secondEpoch)).toBe(true)
  })

  it('rejects re-acquiring the session while it is still active', () => {
    const epoch = acquireNotesRelocationSession('window-a')

    expect(() => acquireNotesRelocationSession('window-a')).toThrow(
      expect.objectContaining({
        code: notesRelocationErrorCodes.NOTES_RELOCATION_IN_PROGRESS
      })
    )

    expect(releaseNotesRelocationSession('window-a', epoch)).toBe(true)
  })

  it('only releases the session for the owning window and matching epoch', () => {
    const epoch = acquireNotesRelocationSession('window-a')
    expect(releaseNotesRelocationSession('window-b', epoch)).toBe(false)
    expect(releaseNotesRelocationSession('window-a', epoch + 1)).toBe(false)

    expect(() => acquireNotesRelocationSession('window-c')).toThrow(IpcError)

    expect(releaseNotesRelocationSession('window-a', epoch)).toBe(true)
  })

  it('abandons the session only for the owning window', () => {
    acquireNotesRelocationSession('window-a')
    expect(abandonNotesRelocationSession('window-b')).toBe(false)
    expect(abandonNotesRelocationSession('window-a')).toBe(true)
    const epoch = acquireNotesRelocationSession('window-c')
    expect(releaseNotesRelocationSession('window-c', epoch)).toBe(true)
  })

  it('exposes whether the relocation barrier is active', () => {
    expect(isNotesRelocationBarrierActive()).toBe(false)
    const epoch = acquireNotesRelocationSession('window-a')
    expect(isNotesRelocationBarrierActive()).toBe(true)
    expect(releaseNotesRelocationSession('window-a', epoch)).toBe(true)
    expect(isNotesRelocationBarrierActive()).toBe(false)
  })

  it('does not abandon the session while migrate is in flight', () => {
    acquireNotesRelocationSession('window-a')
    setNotesRelocationMigrateInFlight(true)

    expect(abandonNotesRelocationSession('window-a')).toBe(false)
    expect(() => acquireNotesRelocationSession('window-b')).toThrow(IpcError)

    setNotesRelocationMigrateInFlight(false)
    expect(abandonNotesRelocationSession('window-a')).toBe(true)
  })
})
