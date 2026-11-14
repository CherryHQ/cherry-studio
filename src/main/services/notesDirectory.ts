import { isNotesDirectoryAcceptedForLoading } from './notesDirectoryValidation'

// Keep the shared loading/picker/migration policy on the current IPC entry point.
export function validateNotesDirectory(dirPath: string): boolean {
  return isNotesDirectoryAcceptedForLoading(dirPath)
}
