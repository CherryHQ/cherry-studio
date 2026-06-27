/**
 * Promote a v1 inline base64 entity image (provider / mini-app logo, or user
 * avatar) into a v2 `file_entry` + `file_ref`, returning the new file-entry id.
 *
 * v1 stored these as base64 data URLs (provider logos in Dexie under
 * `image://provider-<id>`, custom mini-app logos in `custom-minapps.json`, the
 * avatar under `image://avatar`). v2 keeps them on disk and renders them via
 * `resolveStoredImageSrc`, which builds `{id}.webp` — so the bytes must be
 * normalized to WebP here (128×128 cover-crop, matching the renderer's
 * `normalizeImageToWebp`), not stored raw.
 *
 * Writes through the caller's tx (file_entry + file_ref) so it composes inside
 * the migrator's transaction; the physical file write is non-transactional —
 * same risk model as `ChatMappings.promoteBase64ToFileEntry`. Non-data-URL
 * values (a plain url / icon ref / emoji) return `null`; the caller keeps those
 * as-is. Any decode/transcode failure also returns `null` (the owner falls back
 * to its default) rather than aborting the migration.
 */

import fs from 'node:fs/promises'
import path from 'node:path'

import { fileEntryTable, fileRefTable } from '@data/db/schemas/file'
import type { DbType } from '@data/db/types'
import { loggerService } from '@logger'
import type { FileEntryId, FileRefSourceType } from '@shared/data/types/file'
import type { FilePath } from '@shared/types/file/common'
import sharp from 'sharp'
import { v7 as uuidv7 } from 'uuid'

const logger = loggerService.withContext('ImageMigration')

const BASE64_DATA_URL_RE = /^data:([^;,]+);base64,(.+)$/
const ENTITY_IMAGE_DIMENSION = 128

/** The single-file `file_ref` slot an image belongs to (provider/mini-app logo, or avatar). */
export interface EntityImageRef {
  sourceType: FileRefSourceType
  sourceId: string
  role: string
}

export async function migrateBase64ImageToFileEntry(
  tx: Pick<DbType, 'insert'>,
  filesDataDir: string,
  ref: EntityImageRef,
  value: string
): Promise<FileEntryId | null> {
  const match = BASE64_DATA_URL_RE.exec(value)
  // Not a data URL (plain url / icon ref / emoji) — caller keeps it as-is.
  if (!match) return null

  let webp: Buffer
  try {
    // ponytail: first frame for animated gifs — fine for a 128² entity image.
    webp = await sharp(Buffer.from(match[2], 'base64'))
      .resize(ENTITY_IMAGE_DIMENSION, ENTITY_IMAGE_DIMENSION, { fit: 'cover' })
      .webp()
      .toBuffer()
  } catch (error) {
    logger.warn('Failed to transcode v1 image to WebP; dropping it', {
      sourceType: ref.sourceType,
      sourceId: ref.sourceId,
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
      name: ref.role,
      ext: 'webp',
      size: webp.length,
      externalPath: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now
    })
    await tx.insert(fileRefTable).values({
      fileEntryId: id,
      sourceType: ref.sourceType,
      sourceId: ref.sourceId,
      role: ref.role
    })
    return id
  } catch (error) {
    if (written) await fs.unlink(physicalPath).catch(() => {})
    logger.warn('Failed to persist v1 image file_entry; dropping it', {
      sourceType: ref.sourceType,
      sourceId: ref.sourceId,
      error: error instanceof Error ? error.message : String(error)
    })
    return null
  }
}
