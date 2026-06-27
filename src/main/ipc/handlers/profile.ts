import { application } from '@application'
import { deleteEntityImage, storeEntityImage } from '@main/services/file/entityImageFile'
import type { FileEntryId } from '@shared/data/types/file'
import type { profileRequestSchemas } from '@shared/ipc/schemas/profile'
import type { IpcHandlersFor } from '@shared/ipc/types'

/** file_entry ids are UUIDs; anything else is an emoji / icon ref / url / preset id. */
const FILE_ENTRY_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** True when `value` is a stored avatar reference (a file-entry id). */
function isStoredImageId(value: string | null | undefined): value is FileEntryId {
  return !!value && FILE_ENTRY_ID_RE.test(value)
}

/**
 * Profile request handler. `set_avatar` owns the `app.user.avatar` Preference and
 * the on-disk avatar file: it stores/clears the file and updates the preference
 * atomically, then reclaims any superseded stored image.
 */
export const profileHandlers: IpcHandlersFor<typeof profileRequestSchemas> = {
  'profile.set_avatar': async (input) => {
    const preferences = application.get('PreferenceService')
    const previous = preferences.get('app.user.avatar')
    const previousFileId = isStoredImageId(previous) ? previous : null

    if (input.kind === 'image') {
      const newId = await storeEntityImage(input.data, 'user_avatar')
      try {
        await preferences.set('app.user.avatar', newId)
      } catch (error) {
        // The preference write is the commit point; if it fails, reclaim the
        // just-stored file so a failed upload can't leak an orphan entry.
        await deleteEntityImage(newId)
        throw error
      }
      await deleteEntityImage(previousFileId)
      return
    }

    await preferences.set('app.user.avatar', input.value)
    await deleteEntityImage(previousFileId)
  }
}
