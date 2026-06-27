import { application } from '@application'
import { fileRefService } from '@data/services/FileRefService'
import { withCreatedImageEntry } from '@main/ipc/handlers/utils/entityImageBinding'
import { tagStoredFileRef, USER_AVATAR_SOURCE_ID, userAvatarRef } from '@shared/data/types/file'
import type { profileRequestSchemas } from '@shared/ipc/schemas/profile'
import type { IpcHandlersFor } from '@shared/ipc/types'

/** The singleton avatar's single-file slot. */
const AVATAR_SLOT = { sourceType: userAvatarRef.sourceType, sourceId: USER_AVATAR_SOURCE_ID }

/**
 * Profile request handler. `set_avatar` is the avatar owner. The owner invariant
 * — the `user_avatar` `file_ref` slot and the `app.user.avatar` preference must
 * agree on which file (if any) the avatar is — is kept atomic by doing the slot
 * cleanup, the slot ref insert, and the preference row write in a single
 * `DbService.withWriteTx`, then syncing the preference cache / broadcasting only
 * after the tx commits (the `afterCommit` callback). A rolled-back tx therefore
 * never leaves the slot and the preference pointing at different files.
 *
 * For an uploaded image the `file_entry` is created first (a bad upload leaves
 * the old avatar intact) and `permanentDelete`-compensated if the tx fails — the
 * compensation wraps only the tx, not `afterCommit`, so a committed avatar is
 * never deleted by a later cache/broadcast hiccup. Emoji / clear are file-free.
 */
export const profileHandlers: IpcHandlersFor<typeof profileRequestSchemas> = {
  'profile.set_avatar': async (input) => {
    const preferences = application.get('PreferenceService')
    const db = application.get('DbService')

    if (input.kind === 'image') {
      // withCreatedImageEntry compensates (permanentDelete) iff the tx throws;
      // its bind returns the post-commit callback, run outside that scope.
      const afterCommit = await withCreatedImageEntry(input.data, (fileId) =>
        db.withWriteTx(async (tx) => {
          await fileRefService.cleanupBySourceTx(tx, AVATAR_SLOT)
          await fileRefService.createTx(tx, { fileEntryId: fileId, ...AVATAR_SLOT, role: 'avatar' })
          return preferences.setTx(tx, 'app.user.avatar', tagStoredFileRef(fileId))
        })
      )
      await afterCommit()
      return
    }

    // Emoji / clear — no file. Clear the slot, then store the value verbatim
    // (emoji glyph, or `''` to reset to the bundled default).
    const value = input.kind === 'emoji' ? input.emoji : ''
    const afterCommit = await db.withWriteTx(async (tx) => {
      await fileRefService.cleanupBySourceTx(tx, AVATAR_SLOT)
      return preferences.setTx(tx, 'app.user.avatar', value)
    })
    await afterCommit()
  }
}
