import { isAllowedNotesDirectory } from './notesRelocation'

// Selection, migration and restart resolution must agree on protected paths.
export function validateNotesDirectory(dirPath: string): boolean {
  return isAllowedNotesDirectory(dirPath)
}
