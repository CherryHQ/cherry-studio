import { Mutex } from 'async-mutex'

import { application } from '@application'
import { loggerService } from '@logger'
import { withCreatedImageEntry } from '@main/services/entityImageBinding'
import { FileEntryIdSchema, type FileEntryId, STORED_FILE_REF_PREFIX, tagStoredFileRef } from '@shared/data/types/file'
import type { profileRequestSchemas } from '@shared/ipc/schemas/profile'
import type { IpcHandlersFor } from '@shared/ipc/types'

const avatarMutex = new Mutex()
const retiredAvatars = new Set<FileEntryId>()
const logger = loggerService.withContext('profile')

function avatarFileId(value: string): FileEntryId | undefined {
  if (!value.startsWith(STORED_FILE_REF_PREFIX)) return undefined
  const parsed = FileEntryIdSchema.safeParse(value.slice(STORED_FILE_REF_PREFIX.length))
  return parsed.success ? parsed.data : undefined
}

async function retireAvatar(previousId: FileEntryId | undefined): Promise<void> {
  const currentId = avatarFileId(application.get('PreferenceService').get('app.user.avatar'))
  if (previousId && previousId !== currentId) retiredAvatars.add(previousId)
  if (currentId) retiredAvatars.delete(currentId)
  for (const id of retiredAvatars) {
    try {
      await application.get('FileManager').deleteUnreferencedInternalEntry(id)
      retiredAvatars.delete(id)
    } catch (error) {
      logger.error(`Failed to retire avatar file_entry ${id}; will retry on the next avatar update`, error as Error)
    }
  }
}

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
 *
 * The create→bind→compensate is orchestrated inline here (not via `entityLogo`
 * like provider / mini-app logos) on purpose: the avatar's owner is a single
 * Preference, not a DataApi row + `file_ref` slot, so there is no shared bind
 * shape to factor out — it just composes the `withCreatedImageEntry` primitive.
 * Updates are serialized; replaced files are retired only after the new value
 * commits. Cleanup errors are logged and retried on a later update in this process.
 */
export const profileHandlers: IpcHandlersFor<typeof profileRequestSchemas> = {
  'profile.set_avatar': (input) =>
    avatarMutex.runExclusive(async () => {
      const preferences = application.get('PreferenceService')
      const previousId = avatarFileId(preferences.get('app.user.avatar'))

      if (input.kind === 'image') {
        // `manual`: the avatar id lives only in this Preference (no ref table), so
        // the cleanup anti-join would reclaim it if it were auto-managed.
        await withCreatedImageEntry(input.data, 'manual', async (fileId) => {
          await preferences.set('app.user.avatar', tagStoredFileRef(fileId))
        })
      } else {
        await preferences.set('app.user.avatar', input.kind === 'emoji' ? input.emoji : '')
      }
      await retireAvatar(previousId)
    })
}
