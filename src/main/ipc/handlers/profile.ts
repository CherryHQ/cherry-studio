import { application } from '@application'
import { withCreatedImageEntry } from '@main/services/file/utils/entityImageBinding'
import { tagStoredFileRef } from '@shared/data/types/file'
import type { profileRequestSchemas } from '@shared/ipc/schemas/profile'
import type { IpcHandlersFor } from '@shared/ipc/types'

/**
 * Profile request handler. `set_avatar` is the avatar owner. The avatar is
 * persisted **only** in the `app.user.avatar` preference — an uploaded image
 * as a `file:<id>` ref, an emoji verbatim, `''` for the bundled default. There
 * is deliberately no `file_ref` row for it: the preference is the single copy
 * of the fact, so no cross-store invariant (and no tx composition) exists. The
 * trade — no FK, so the ref is not DB-validated and pruning a `file_entry`
 * cannot null it — is acceptable because the renderer falls back to the
 * default avatar for an unresolvable ref.
 *
 * For an uploaded image the `file_entry` is created first (a bad upload leaves
 * the old avatar intact) and `permanentDelete`-compensated if the preference
 * write fails, so a failed set never leaks an orphan file.
 */
export const profileHandlers: IpcHandlersFor<typeof profileRequestSchemas> = {
  'profile.set_avatar': async (input) => {
    const preferences = application.get('PreferenceService')

    if (input.kind === 'image') {
      await withCreatedImageEntry(input.data, async (fileId) => {
        await preferences.set('app.user.avatar', tagStoredFileRef(fileId))
      })
      return
    }

    await preferences.set('app.user.avatar', input.kind === 'emoji' ? input.emoji : '')
  }
}
