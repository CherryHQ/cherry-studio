/**
 * Promote a v1 inline base64 entity logo (provider / mini-app) into a v2
 * `file_entry` + `file_ref`, returning the new file-entry id for the owner
 * row's `logoFileId` column.
 *
 * v1 stored uploaded logos as base64 data URLs (provider logos in Dexie under
 * `image://provider-<id>`; custom mini-app logos in `custom-minapps.json`). v2
 * keeps uploads on disk and renders them through `resolveStoredImageSrc`, which
 * hardcodes `{id}.webp` — so the bytes must be normalized to WebP here (128×128
 * cover-crop, matching the renderer's `normalizeImageToWebp`), not stored raw.
 *
 * Writes through the caller's tx (file_entry + file_ref) so it composes inside
 * the migrator's transaction; the physical file write is non-transactional —
 * same risk model as `ChatMappings.promoteBase64ToFileEntry`. Non-data-URL
 * values (a plain url / icon ref) return `null`; the caller stores those on
 * `logoKey` instead. Any decode/transcode failure also returns `null` (the
 * owner falls back to its bundled icon) rather than aborting the migration.
 */

import fs from 'node:fs/promises'
import path from 'node:path'

import { fileEntryTable } from '@data/db/schemas/file'
import type { DbType } from '@data/db/types'
import { reconcileLogoSlotTx } from '@data/services/utils/logoRef'
import { loggerService } from '@logger'
import type { FileEntryId, FileRefSourceType } from '@shared/data/types/file'
import type { FilePath } from '@shared/types/file/common'
import sharp from 'sharp'
import { v7 as uuidv7 } from 'uuid'

const logger = loggerService.withContext('LogoMigration')

const BASE64_DATA_URL_RE = /^data:([^;,]+);base64,(.+)$/
const ENTITY_LOGO_DIMENSION = 128

export async function migrateBase64LogoToFileEntry(
  tx: Pick<DbType, 'delete' | 'insert'>,
  filesDataDir: string,
  slot: { sourceType: FileRefSourceType; sourceId: string },
  value: string
): Promise<FileEntryId | null> {
  const match = BASE64_DATA_URL_RE.exec(value)
  // Not a data URL (plain url / icon ref) — caller keeps it on `logoKey`.
  if (!match) return null

  let webp: Buffer
  try {
    // ponytail: first frame for animated gifs — fine for a 128² logo.
    webp = await sharp(Buffer.from(match[2], 'base64'))
      .resize(ENTITY_LOGO_DIMENSION, ENTITY_LOGO_DIMENSION, { fit: 'cover' })
      .webp()
      .toBuffer()
  } catch (error) {
    logger.warn('Failed to transcode v1 logo to WebP; dropping it', {
      sourceId: slot.sourceId,
      error: error instanceof Error ? error.message : String(error)
    })
    return null
  }

  const id = uuidv7()
  const physicalPath = path.join(filesDataDir, `${id}.webp`) as FilePath
  let written = false
  try {
    await fs.mkdir(path.dirname(physicalPath), { recursive: true })
    await fs.writeFile(physicalPath, webp)
    written = true

    const now = Date.now()
    await tx.insert(fileEntryTable).values({
      id,
      origin: 'internal',
      name: 'logo',
      ext: 'webp',
      size: webp.length,
      externalPath: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now
    })
    await reconcileLogoSlotTx(tx, slot, { kind: 'file', fileId: id })
    return id
  } catch (error) {
    if (written) await fs.unlink(physicalPath).catch(() => {})
    logger.warn('Failed to persist v1 logo file_entry; dropping it', {
      sourceId: slot.sourceId,
      error: error instanceof Error ? error.message : String(error)
    })
    return null
  }
}
