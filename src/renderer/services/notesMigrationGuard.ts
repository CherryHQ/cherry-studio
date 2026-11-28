import { notesMigrationLock } from '@renderer/services/notesMigrationLock'
import { toast } from '@renderer/services/toast'

export function blockNotesActionsDuringMigration(t: (key: string) => string): boolean {
  if (!notesMigrationLock.isLocked()) {
    return false
  }
  toast.error(t('settings.data.notes_relocation.error.migration_in_progress'))
  return true
}
