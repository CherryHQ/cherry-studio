import { describe, expect, it } from 'vitest'

import { IpcError } from '@shared/ipc/errors/IpcError'
import { notesRelocationErrorCodes } from '@shared/ipc/errors/notesRelocation'

import {
  abandonNotesRelocationSession,
  acquireNotesRelocationSession,
  releaseNotesRelocationSession,
  setNotesRelocationMigrateInFlight
} from '../notesRelocationSession'

describe('notesRelocationSession', () => {
  it('rejects a second migration while the first session is active', () => {
    acquireNotesRelocationSession('window-a')

    expect(() => acquireNotesRelocationSession('window-b')).toThrow(
      expect.objectContaining({
        code: notesRelocationErrorCodes.NOTES_RELOCATION_IN_PROGRESS
      })
    )

    releaseNotesRelocationSession('window-a')
    expect(() => acquireNotesRelocationSession('window-b')).not.toThrow()
    releaseNotesRelocationSession('window-b')
  })

  it('only releases the session for the owning window', () => {
    acquireNotesRelocationSession('window-a')
    releaseNotesRelocationSession('window-b')

    expect(() => acquireNotesRelocationSession('window-c')).toThrow(IpcError)

    releaseNotesRelocationSession('window-a')
  })

  it('abandons the session only for the owning window', () => {
    acquireNotesRelocationSession('window-a')
    expect(abandonNotesRelocationSession('window-b')).toBe(false)
    expect(abandonNotesRelocationSession('window-a')).toBe(true)
    expect(() => acquireNotesRelocationSession('window-c')).not.toThrow()
    releaseNotesRelocationSession('window-c')
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
