import { Mutex } from 'async-mutex'

import { application } from '@application'
import { loggerService } from '@logger'
import { FileEntryIdSchema, type FileEntryId, STORED_FILE_REF_PREFIX, tagStoredFileRef } from '@shared/data/types/file'
import type { InputFor } from '@shared/ipc/types'

import { withCreatedImageEntry } from './entityImageBinding'

const logger = loggerService.withContext('ProfileService')

function avatarFileId(value: string): FileEntryId | undefined {
  if (!value.startsWith(STORED_FILE_REF_PREFIX)) return undefined
  const parsed = FileEntryIdSchema.safeParse(value.slice(STORED_FILE_REF_PREFIX.length))
  return parsed.success ? parsed.data : undefined
}

class ProfileService {
  private readonly avatarMutex = new Mutex()
  private readonly retiredAvatars = new Set<FileEntryId>()

  /**
   * The avatar lives only in Preference, without a file_ref row. Serialize updates,
   * compensate failed binds, and retire replaced files after the new value commits.
   * Failed retirement is retried on a later update in this process.
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
    const currentId = avatarFileId(application.get('PreferenceService').get('app.user.avatar'))
    if (previousId && previousId !== currentId) this.retiredAvatars.add(previousId)
    if (currentId) this.retiredAvatars.delete(currentId)
    for (const id of this.retiredAvatars) {
      try {
        await application.get('FileManager').deleteUnreferencedInternalEntry(id)
        this.retiredAvatars.delete(id)
      } catch (error) {
        logger.error(`Failed to retire avatar file_entry ${id}; will retry on the next avatar update`, error as Error)
      }
    }
  }
}

export const profileService = new ProfileService()
