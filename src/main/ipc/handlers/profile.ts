import { application } from '@application'
import { fileRefService } from '@data/services/FileRefService'
import { withCreatedImageEntry } from '@main/ipc/handlers/utils/entityImageBinding'
import { tagStoredFileRef, USER_AVATAR_SOURCE_ID, userAvatarRef } from '@shared/data/types/file'
import type { profileRequestSchemas } from '@shared/ipc/schemas/profile'
import type { IpcHandlersFor } from '@shared/ipc/types'

/** The singleton avatar's single-file slot. */
const AVATAR_SLOT = { sourceType: userAvatarRef.sourceType, sourceId: USER_AVATAR_SOURCE_ID }

/**
 * Profile request handler. `set_avatar` is the avatar owner. An uploaded image
 * is sent as raw bytes: the handler creates the `file_entry` (after a successful
 * transcode), points the `user_avatar` `file_ref` slot at it, and stores a
 * `file:<id>` ref in `app.user.avatar` — compensating (permanentDelete) if the
 * slot/preference write fails. Emoji / clear are file-free preference writes.
 */
export const profileHandlers: IpcHandlersFor<typeof profileRequestSchemas> = {
  'profile.set_avatar': async (input) => {
    const preferences = application.get('PreferenceService')

    if (input.kind === 'image') {
      // createInternalEntry runs first (a bad upload leaves the old avatar
      // intact); the slot + preference write happens in the bound callback so a
      // failure there triggers compensation of the just-created file.
      await withCreatedImageEntry(input.data, async (fileId) => {
        await fileRefService.cleanupBySource(AVATAR_SLOT)
        await fileRefService.create({ fileEntryId: fileId, ...AVATAR_SLOT, role: 'avatar' })
        await preferences.set('app.user.avatar', tagStoredFileRef(fileId))
      })
      return
    }

    // Emoji / clear — no file. Clear the slot, then store the value verbatim
    // (emoji glyph, or `''` to reset to the bundled default).
    await fileRefService.cleanupBySource(AVATAR_SLOT)
    await preferences.set('app.user.avatar', input.kind === 'emoji' ? input.emoji : '')
  }
}
