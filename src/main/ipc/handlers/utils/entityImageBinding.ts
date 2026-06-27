import { application } from '@application'
import { transcodeToEntityWebp } from '@main/services/file/utils/entityImageWebp'
import type { LogoBindInput } from '@shared/data/api/schemas/logo'
import type { FileEntryId } from '@shared/data/types/file'
import type { LogoImageIntent } from '@shared/ipc/schemas/entityImage'

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
  bind: (fileId: FileEntryId) => Promise<T>
): Promise<T> {
  const fileManager = application.get('FileManager')
  const webp = await transcodeToEntityWebp(bytes)
  const entry = await fileManager.createInternalEntry({ source: 'bytes', data: webp, name: 'image', ext: 'webp' })
  try {
    return await bind(entry.id)
  } catch (error) {
    await fileManager.permanentDelete(entry.id).catch(() => {})
    throw error
  }
}

/**
 * Apply a provider / mini-app logo intent: image bytes → create the file then
 * bind it as `{ kind: 'file' }`; preset key / clear → bind directly (no file).
 * `bind` is the owner's pure-DB slot reconcile (`reconcileLogoSlotTx`, reached
 * via the DataApi service) — the only `fileId` it ever sees is one just minted.
 */
export async function bindLogoImage(
  image: LogoImageIntent,
  bind: (input: LogoBindInput) => Promise<void>
): Promise<void> {
  if (image.kind === 'key') return bind({ kind: 'key', key: image.key })
  if (image.kind === 'clear') return bind({ kind: 'clear' })
  await withCreatedImageEntry(image.data, (fileId) => bind({ kind: 'file', fileId }))
}
