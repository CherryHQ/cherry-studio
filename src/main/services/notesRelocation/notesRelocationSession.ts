import { IpcError } from '@shared/ipc/errors/IpcError'
import { notesRelocationErrorCodes } from '@shared/ipc/errors/notesRelocation'

let notesRelocationSessionOwnerId: string | null = null
let notesRelocationSessionEpoch = 0
let notesRelocationMigrateInFlight = false

export function setNotesRelocationMigrateInFlight(inFlight: boolean): void {
  notesRelocationMigrateInFlight = inFlight
}

export function acquireNotesRelocationSession(ownerId: string): number {
  if (notesRelocationSessionOwnerId != null && notesRelocationSessionOwnerId !== ownerId) {
    throw new IpcError(
      notesRelocationErrorCodes.NOTES_RELOCATION_IN_PROGRESS,
      'another notes directory migration is already in progress'
    )
  }
  if (notesRelocationSessionOwnerId == null) {
    notesRelocationSessionOwnerId = ownerId
    notesRelocationSessionEpoch += 1
  }
  return notesRelocationSessionEpoch
}

export function assertNotesRelocationSessionOwner(ownerId: string, sessionEpoch: number): void {
  if (notesRelocationSessionOwnerId !== ownerId || notesRelocationSessionEpoch !== sessionEpoch) {
    throw new IpcError(
      notesRelocationErrorCodes.NOTES_RELOCATION_FAILED,
      'notes relocation session is not active for this window'
    )
  }
}

export function releaseNotesRelocationSession(ownerId: string, sessionEpoch: number): boolean {
  if (notesRelocationSessionOwnerId !== ownerId || notesRelocationSessionEpoch !== sessionEpoch) {
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

/** Resets module state for unit tests. */
export function resetNotesRelocationSessionForTests(): void {
  notesRelocationSessionOwnerId = null
  notesRelocationSessionEpoch = 0
  notesRelocationMigrateInFlight = false
}
