import FileManager from '@renderer/services/FileManager'
import type { FileMetadata } from '@renderer/types'
import type { Painting as PaintingRecord } from '@shared/data/types/painting'

import type { PaintingData } from '../types/paintingData'
import { cleanRuntime, readRuntime } from '../utils/paintingGenerationParams'

const LEGACY_RUNTIME_PARAM_KEYS = new Set(['taskId', 'taskStatus', 'generationId', 'runtimeProviderId'])

export async function recordToPaintingData(record: PaintingRecord): Promise<PaintingData> {
  const files = (
    await Promise.all((record.files?.output ?? []).map(async (id) => (await FileManager.getFile(id)) ?? null))
  ).filter((file): file is FileMetadata => Boolean(file))

  let rawParams = { ...record.params }
  const generationFields = readRuntime(rawParams)
  rawParams = cleanRuntime(rawParams)

  for (const key of LEGACY_RUNTIME_PARAM_KEYS) {
    delete rawParams[key]
  }

  return {
    id: record.id,
    providerId: record.providerId,
    mode: record.mode,
    mediaType: record.mediaType,
    model: record.model ?? undefined,
    prompt: record.prompt,
    files,
    persistedAt: record.createdAt,
    ...generationFields,
    ...rawParams
  } as PaintingData
}

export function recordsToPaintingDataList(records: PaintingRecord[]): Promise<PaintingData[]> {
  return Promise.all(records.map(recordToPaintingData))
}
