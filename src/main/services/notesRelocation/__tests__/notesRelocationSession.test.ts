import { describe, expect, it } from 'vitest'

import { IpcError } from '@shared/ipc/errors/IpcError'
import { notesRelocationErrorCodes } from '@shared/ipc/errors/notesRelocation'

import {
  acquireNotesRelocationSession,
  releaseNotesRelocationSession
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
})
