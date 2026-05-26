import FileManager from '@renderer/services/FileManager'
import type { FileMetadata } from '@renderer/types'
import { isUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'
import type { Painting as PaintingRecord } from '@shared/data/types/painting'

import type { PaintingData } from '../types/paintingData'

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

async function resolveFiles(ids: string[]): Promise<FileMetadata[]> {
  return (await Promise.all(ids.map(async (id) => (await FileManager.getFile(id)) ?? null))).filter(
    (file): file is FileMetadata => Boolean(file)
  )
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
  const files = await resolveFiles(record.files.output)
  const inputFiles = await resolveFiles(record.files.input)

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
  } as PaintingData
}

export function recordsToPaintingDataList(records: PaintingRecord[]): Promise<PaintingData[]> {
  return Promise.all(records.map(recordToPaintingData))
}
