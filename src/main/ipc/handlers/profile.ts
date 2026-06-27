import { application } from '@application'
import { fileRefService } from '@data/services/FileRefService'
import { USER_AVATAR_SOURCE_ID, userAvatarRef } from '@shared/data/types/file'
import type { profileRequestSchemas } from '@shared/ipc/schemas/profile'
import type { IpcHandlersFor } from '@shared/ipc/types'

/** The singleton avatar's single-file slot. */
const AVATAR_SLOT = { sourceType: userAvatarRef.sourceType, sourceId: USER_AVATAR_SOURCE_ID }

/**
 * Profile request handler. `set_avatar` is the avatar owner — DB-only: it
 * reconciles the `user_avatar` single-file `file_ref` slot and the
 * `app.user.avatar` Preference. The renderer pre-stores any uploaded image and
 * passes its opaque id; superseded files are preserved per the file layer's
 * policy (no filesystem access here).
 */
export const profileHandlers: IpcHandlersFor<typeof profileRequestSchemas> = {
  'profile.set_avatar': async (input) => {
    const preferences = application.get('PreferenceService')

    // Single-file slot: clear any existing ref, then re-point if a file is set.
    await fileRefService.cleanupBySource(AVATAR_SLOT)

    if (input.kind === 'file') {
      await fileRefService.create({ fileEntryId: input.fileId, ...AVATAR_SLOT, role: 'avatar' })
      await preferences.set('app.user.avatar', input.fileId)
      return
    }

    // Emoji / preset / '' (reset) — stored verbatim.
    await preferences.set('app.user.avatar', input.value)
  }
}
