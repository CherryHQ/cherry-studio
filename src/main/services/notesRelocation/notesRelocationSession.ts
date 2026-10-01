import { IpcError } from '@shared/ipc/errors/IpcError'
import { notesRelocationErrorCodes } from '@shared/ipc/errors/notesRelocation'

let notesRelocationInProgress = false

export async function withNotesRelocationExclusive<T>(run: () => Promise<T>): Promise<T> {
  if (notesRelocationInProgress) {
    throw new IpcError(
      notesRelocationErrorCodes.NOTES_RELOCATION_IN_PROGRESS,
      'another notes directory migration is already in progress'
    )
  }

  notesRelocationInProgress = true
  try {
    return await run()
  } finally {
    notesRelocationInProgress = false
  }
}
