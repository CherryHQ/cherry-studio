import { application } from '@application'
import { loggerService } from '@logger'
import { transcodeToIconWebp } from '@main/utils/image'
import type { FileEntryId } from '@shared/data/types/file'

const logger = loggerService.withContext('uploadedIcon')

type MaybePromise<T> = T | Promise<T>

/**
 * Create a normalized icon FileEntry, bind it, and compensate with permanent
 * deletion if binding fails after the entry has committed.
 */
export async function withUploadedIconEntry<T>(
  bytes: Uint8Array,
  bind: (fileId: FileEntryId) => MaybePromise<T>
): Promise<T> {
  const fileManager = application.get('FileManager')
  const webp = await transcodeToIconWebp(bytes)
  const entry = await fileManager.createInternalEntry({ source: 'bytes', data: webp, name: 'image', ext: 'webp' })
  try {
    return await bind(entry.id)
  } catch (error) {
    await fileManager.permanentDelete(entry.id).catch((cleanupError) => {
      logger.error(`Failed to delete orphaned file_entry ${entry.id} after bind failure`, cleanupError as Error)
    })
    throw error
  }
}
