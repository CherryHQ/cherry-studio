import { application } from '@application'
import type { LogoBindInput } from '@data/services/utils/entityImageRef'
import { loggerService } from '@logger'
import { transcodeToEntityWebp } from '@main/utils/image'
import type { FileEntryId } from '@shared/data/types/file'
import type { LogoImageIntent } from '@shared/ipc/schemas/entityImage'

const logger = loggerService.withContext('entityImageBinding')

type MaybePromise<T> = T | Promise<T>

/**
 * Create an entity-image `file_entry` from raw upload bytes, run `bind` with the
 * new id, and **compensate** (`permanentDelete`) if `bind` throws — so a bind
 * failure never leaves an orphan file. This is the ONLY place a live
 * entity-image `file_entry` is created; the renderer no longer pre-creates one.
 * `createInternalEntry` already self-cleans if its own row insert fails; this
 * covers the *bind* failure that happens after the file row committed.
 */
export async function withCreatedImageEntry<T>(
  bytes: Uint8Array,
  bind: (fileId: FileEntryId) => MaybePromise<T>
): Promise<T> {
  const fileManager = application.get('FileManager')
  const webp = await transcodeToEntityWebp(bytes)
  const entry = await fileManager.createInternalEntry({ source: 'bytes', data: webp, name: 'image', ext: 'webp' })
  try {
    return await bind(entry.id)
  } catch (error) {
    // Compensating delete is best-effort, but if it ALSO fails (often correlated
    // with whatever broke bind) the file_entry + WebP are orphaned — log so the
    // orphan is traceable rather than silently voiding the no-orphan guarantee.
    await fileManager.permanentDelete(entry.id).catch((cleanupError) => {
      logger.error(`Failed to delete orphaned file_entry ${entry.id} after bind failure`, cleanupError as Error)
    })
    throw error
  }
}

/**
 * Apply a provider / mini-app logo intent: image bytes → create the file then
 * bind it as `{ kind: 'file' }`; preset key / default → bind directly (no file).
 * `bind` is the owner's pure-DB slot reconcile (`reconcileLogoSlotTx`, reached
 * via the DataApi service) — the only `fileId` it ever sees is one just minted.
 */
export async function bindLogoImage(
  image: LogoImageIntent,
  bind: (input: LogoBindInput) => MaybePromise<void>
): Promise<void> {
  if (image.kind === 'key') return bind({ kind: 'key', key: image.key })
  if (image.kind === 'default') return bind({ kind: 'default' })
  await withCreatedImageEntry(image.data, (fileId) => bind({ kind: 'file', fileId }))
}
