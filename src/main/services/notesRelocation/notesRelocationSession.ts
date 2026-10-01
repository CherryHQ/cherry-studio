import { IpcError } from '@shared/ipc/errors/IpcError'
import { notesRelocationErrorCodes } from '@shared/ipc/errors/notesRelocation'

let notesRelocationSessionOwnerId: string | null = null

export function acquireNotesRelocationSession(ownerId: string): void {
  if (notesRelocationSessionOwnerId != null) {
    throw new IpcError(
      notesRelocationErrorCodes.NOTES_RELOCATION_IN_PROGRESS,
      'another notes directory migration is already in progress'
    )
  }
  notesRelocationSessionOwnerId = ownerId
}

export function releaseNotesRelocationSession(ownerId: string): void {
  if (notesRelocationSessionOwnerId === ownerId) {
    notesRelocationSessionOwnerId = null
  }
}

export function isNotesRelocationSessionActive(): boolean {
  return notesRelocationSessionOwnerId != null
}
