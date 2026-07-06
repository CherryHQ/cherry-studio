/**
 * Promote a v1 inline base64 entity image (provider / mini-app logo, or user
 * avatar) into a v2 `file_entry`, returning the new file-entry id. Provider /
 * mini-app logos additionally get a single-file `file_ref` slot row; the avatar
 * deliberately does NOT — the `app.user.avatar` preference is its only
 * persisted copy.
 *
 * v1 stored these as base64 data URLs (provider logos in Dexie under
 * `image://provider-<id>`, custom mini-app logos in `custom-minapps.json`, the
 * avatar under `image://avatar`). v2 keeps them on disk as normalized WebP
 * (128×128 cover-crop via `transcodeToEntityWebp`, matching the live upload
 * path) — so the bytes must be transcoded here, not stored raw.
 *
 * The physical file write is non-transactional — same risk model as
 * `ChatMappings.promoteBase64ToFileEntry`. Callers that need a DB transaction
 * prepare the file first, then insert the file_entry (+ file_ref, if any)
 * synchronously inside their transaction.
 */

import fs from 'node:fs/promises'
import path from 'node:path'

import { fileEntryTable } from '@data/db/schemas/file'
import type { DbType } from '@data/db/types'
import { insertSingleFileRefTx, type SingleFileRefSourceType } from '@data/services/utils/logoRef'
import { loggerService } from '@logger'
import { transcodeToEntityWebp } from '@main/services/entityImageWebp'
import type { FileEntryId } from '@shared/data/types/file'
import type { FilePath } from '@shared/types/file'
import { v7 as uuidv7 } from 'uuid'

const logger = loggerService.withContext('ImageMigration')

const BASE64_DATA_URL_RE = /^data:([^;,]+);base64,(.+)$/

/**
 * Where a prepared image came from — used for log context and the entry name.
 * Whether a ref row exists (and in which table) is the caller's concern.
 */
export interface EntityImageDescriptor {
  sourceType: string
  sourceId: string
  role: string
}

/** The single-file ref slot an image belongs to (provider/mini-app logo). */
export interface EntityImageRef extends EntityImageDescriptor {
  sourceType: SingleFileRefSourceType
}

type InsertFileEntryRow = typeof fileEntryTable.$inferInsert

export interface PreparedEntityImageFile<R extends EntityImageDescriptor = EntityImageDescriptor> {
  id: FileEntryId
  physicalPath: FilePath
  fileEntry: InsertFileEntryRow
  ref: R
}

export async function prepareBase64ImageFileEntry<R extends EntityImageDescriptor>(
  filesDataDir: string,
  ref: R,
  value: string
): Promise<PreparedEntityImageFile<R> | null> {
  const match = BASE64_DATA_URL_RE.exec(value)
  // Not a data URL (plain url / icon ref / emoji) — caller keeps it as-is.
  if (!match) return null

  let webp: Buffer
  try {
    webp = await transcodeToEntityWebp(Buffer.from(match[2], 'base64'))
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
  try {
    await fs.mkdir(path.dirname(physicalPath), { recursive: true })
    await fs.writeFile(physicalPath, webp)

    const now = Date.now()
    return {
      id,
      physicalPath,
      fileEntry: {
        id,
        origin: 'internal',
        name: ref.role,
        ext: 'webp',
        size: webp.length,
        externalPath: null,
        deletedAt: null,
        createdAt: now,
        updatedAt: now
      },
      ref
    }
  } catch (error) {
    logger.warn('Failed to persist v1 image file_entry; dropping it', {
      sourceType: ref.sourceType,
      sourceId: ref.sourceId,
      error: error instanceof Error ? error.message : String(error)
    })
    return null
  }
}

/**
 * Insert only the prepared `file_entry` row — for images whose owner keeps no
 * ref row (the avatar: the `app.user.avatar` preference is its only copy).
 */
export function insertPreparedImageEntryTx(tx: Pick<DbType, 'insert'>, image: PreparedEntityImageFile): void {
  tx.insert(fileEntryTable).values(image.fileEntry).run()
}

export function insertPreparedImageFileTx(
  tx: Pick<DbType, 'insert'>,
  image: PreparedEntityImageFile<EntityImageRef>
): void {
  insertPreparedImageEntryTx(tx, image)
  insertSingleFileRefTx(tx, { sourceType: image.ref.sourceType, sourceId: image.ref.sourceId }, image.id)
}

export async function migrateBase64ImageToFileEntry(
  tx: Pick<DbType, 'insert'>,
  filesDataDir: string,
  ref: EntityImageRef,
  value: string
): Promise<FileEntryId | null> {
  const image = await prepareBase64ImageFileEntry(filesDataDir, ref, value)
  if (!image) return null

  try {
    insertPreparedImageFileTx(tx, image)
    return image.id
  } catch (error) {
    await fs.unlink(image.physicalPath).catch(() => {})
    logger.warn('Failed to persist v1 image file_entry; dropping it', {
      sourceType: ref.sourceType,
      sourceId: ref.sourceId,
      error: error instanceof Error ? error.message : String(error)
    })
    return null
  }
}
