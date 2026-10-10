import { notesEditFlushService } from '@renderer/services/NotesEditFlushService'
import { toast } from '@renderer/services/toast'

export function blockNotesActionsDuringMigration(t: (key: string) => string): boolean {
  if (!notesEditFlushService.getMigrationLocked()) {
    return false
  }
  toast.error(t('settings.data.notes_relocation.error.migration_in_progress'))
  return true
}
