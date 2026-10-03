import { IpcError } from '@shared/ipc/errors/IpcError'
import { notesRelocationErrorCodes } from '@shared/ipc/errors/notesRelocation'

let notesRelocationSessionOwnerId: string | null = null
let notesRelocationMigrateInFlight = false

export function setNotesRelocationMigrateInFlight(inFlight: boolean): void {
  notesRelocationMigrateInFlight = inFlight
}

export function acquireNotesRelocationSession(ownerId: string): void {
  if (notesRelocationSessionOwnerId != null) {
    throw new IpcError(
      notesRelocationErrorCodes.NOTES_RELOCATION_IN_PROGRESS,
      'another notes directory migration is already in progress'
    )
  }
  notesRelocationSessionOwnerId = ownerId
}

export function releaseNotesRelocationSession(ownerId: string): boolean {
  if (notesRelocationSessionOwnerId !== ownerId) {
    return false
  }
  notesRelocationSessionOwnerId = null
  return true
}

export function abandonNotesRelocationSession(ownerId: string): boolean {
  if (notesRelocationSessionOwnerId !== ownerId) {
    return false
  }
  if (notesRelocationMigrateInFlight) {
    return false
  }
  notesRelocationSessionOwnerId = null
  return true
}

export function isNotesRelocationSessionActive(): boolean {
  return notesRelocationSessionOwnerId != null
}
