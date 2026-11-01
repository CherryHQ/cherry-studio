import { application } from '@application'
import { loggerService } from '@logger'
import { FileEntryIdSchema, type FileEntryId, STORED_FILE_REF_PREFIX, tagStoredFileRef } from '@shared/data/types/file'
import type { InputFor } from '@shared/ipc/types'
import { Mutex } from '@shared/utils/async'

import { withCreatedImageEntry } from './entityImageBinding'

const logger = loggerService.withContext('ProfileService')

function avatarFileId(value: string): FileEntryId | undefined {
  if (!value.startsWith(STORED_FILE_REF_PREFIX)) return undefined
  const parsed = FileEntryIdSchema.safeParse(value.slice(STORED_FILE_REF_PREFIX.length))
  return parsed.success ? parsed.data : undefined
}

class ProfileService {
  private readonly avatarMutex = new Mutex()

  /**
   * The avatar lives only in Preference, without a file_ref row. Serialize updates,
   * compensate failed binds, and retire the replaced file after the new value commits.
   */
  setAvatar(input: InputFor<'profile.set_avatar'>): Promise<void> {
    return this.avatarMutex.runExclusive(async () => {
      const preferences = application.get('PreferenceService')
      const previousId = avatarFileId(preferences.get('app.user.avatar'))

      if (input.kind === 'image') {
        // The avatar has no file_ref row, so automatic cleanup would reclaim it.
        await withCreatedImageEntry(input.data, 'manual', async (fileId) => {
          await preferences.set('app.user.avatar', tagStoredFileRef(fileId))
        })
      } else {
        await preferences.set('app.user.avatar', input.kind === 'emoji' ? input.emoji : '')
      }
      await this.retireAvatar(previousId)
    })
  }

  private async retireAvatar(previousId: FileEntryId | undefined): Promise<void> {
    if (!previousId || previousId === avatarFileId(application.get('PreferenceService').get('app.user.avatar'))) return
    try {
      await application.get('FileManager').deleteUnreferencedInternalEntry(previousId)
    } catch (error) {
      // No retry: a leftover manual entry surfaces in the manual-orphan report.
      logger.error(`Failed to retire avatar file_entry ${previousId}`, error as Error)
    }
  }
}

export const profileService = new ProfileService()
