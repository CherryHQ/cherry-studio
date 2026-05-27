import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import type { FileEntry } from '@shared/data/types/file/fileEntry'
import { isUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'
import type { Painting as PaintingRecord } from '@shared/data/types/painting'

import { fileEntryToMetadata } from '../../utils/fileEntryAdapter'
import type { PaintingData } from '../types/paintingData'

const logger = loggerService.withContext('paintings/recordToPaintingData')

/** Maps DB `painting.model_id` into the renderer's API model slug (never the user_model row id alone). */
function normalizeStoredPaintingModel(value: unknown): string | undefined {
  if (value == null) return undefined
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (isUniqueModelId(trimmed)) {
    try {
      return parseUniqueModelId(trimmed).modelId
    } catch {
      return trimmed
    }
  }
  return trimmed
}

/**
 * Look up v2 `FileEntry` rows by id via DataApi, then adapt to FileMetadata.
 *
 * Replaces the v1 `FileManager.getFile(id)` Dexie lookup that returned null
 * for any file produced via the v2 `createInternalEntry` path — which is the
 * default now for painting outputs. Missing ids (404 / migrator drop / user
 * deletion) are filtered out so the painting still hydrates with whatever
 * files do resolve.
 *
 * TODO(#15353): Drop the adapt-to-FileMetadata step once paintings consume
 * `FileEntry` directly and the Artboard uses the `cherrystudio://file/...`
 * custom protocol. `resolveFiles` would then be a thin DataApi pass-through
 * returning `FileEntry[]`.
 */
async function resolveEntries(ids: string[]): Promise<FileEntry[]> {
  if (ids.length === 0) return []
  const entries = await Promise.all(
    ids.map(async (id) => {
      try {
        return (await dataApiService.get(`/files/entries/${id}` as never)) as FileEntry
      } catch (error) {
        logger.warn('Skipping unresolved file_entry for painting', { id, error })
        return null
      }
    })
  )
  return entries.filter((e): e is FileEntry => e !== null)
}

/**
 * Hydrate a persisted painting record (frozen receipt: prompt + files) into
 * the renderer's PaintingData draft shape. The DB record carries no mode,
 * mediaType, or params — those are live form-state concerns. The draft built
 * here defaults `mode` to `'generate'` so callers that select a past painting
 * land on the generate tab; the form will overwrite this when the user picks
 * a different tab.
 */
export async function recordToPaintingData(record: PaintingRecord): Promise<PaintingData> {
  const outputEntries = await resolveEntries(record.files.output)
  const inputFiles = await resolveEntries(record.files.input)
  const files = await Promise.all(outputEntries.map(fileEntryToMetadata))

  const model = normalizeStoredPaintingModel(record.modelId)

  return {
    id: record.id,
    providerId: record.providerId,
    mode: 'generate',
    prompt: record.prompt,
    files,
    inputFiles,
    persistedAt: record.createdAt,
    model
  }
}

export function recordsToPaintingDataList(records: PaintingRecord[]): Promise<PaintingData[]> {
  return Promise.all(records.map(recordToPaintingData))
}
