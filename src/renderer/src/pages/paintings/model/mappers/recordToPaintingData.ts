import FileManager from '@renderer/services/FileManager'
import type { FileMetadata } from '@renderer/types'
import { isUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'
import type { Painting as PaintingRecord } from '@shared/data/types/painting'

import type { PaintingData } from '../types/paintingData'
import { cleanRuntime, readRuntime } from '../utils/paintingGenerationParams'

const LEGACY_RUNTIME_PARAM_KEYS = new Set(['taskId', 'taskStatus', 'generationId', 'runtimeProviderId'])

/** Maps DB `painting.model_id` or legacy params into the renderer's API model slug (never the user_model row id alone). */
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

export async function recordToPaintingData(record: PaintingRecord): Promise<PaintingData> {
  const files = await resolveFiles(record.files.output)
  const inputFiles = await resolveFiles(record.files.input)

  let rawParams = { ...record.params }
  const generationFields = readRuntime(rawParams)
  rawParams = cleanRuntime(rawParams)

  for (const key of LEGACY_RUNTIME_PARAM_KEYS) {
    delete rawParams[key]
  }

  const paramModelCandidate =
    normalizeStoredPaintingModel((rawParams as Record<string, unknown>).model) ??
    normalizeStoredPaintingModel((rawParams as Record<string, unknown>).modelId)

  delete (rawParams as Record<string, unknown>).model
  delete (rawParams as Record<string, unknown>).modelId

  const model = normalizeStoredPaintingModel(record.modelId) ?? paramModelCandidate

  return {
    id: record.id,
    providerId: record.providerId,
    mode: record.mode,
    mediaType: record.mediaType,
    prompt: record.prompt,
    files,
    inputFiles,
    persistedAt: record.createdAt,
    ...generationFields,
    ...rawParams,
    model
  } as PaintingData
}

export function recordsToPaintingDataList(records: PaintingRecord[]): Promise<PaintingData[]> {
  return Promise.all(records.map(recordToPaintingData))
}
