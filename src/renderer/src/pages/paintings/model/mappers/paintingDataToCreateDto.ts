import type { CreatePaintingDto } from '@shared/data/api/schemas/paintings'
import type { PaintingMode } from '@shared/data/types/painting'

import type { PaintingData } from '../types/paintingData'
import { isRuntimeKey } from '../utils/paintingGenerationParams'

type CreatePaintingData = PaintingData & {
  providerId: string
  mode: PaintingMode
}

const RESERVED_PAINTING_PARAM_KEYS = new Set([
  'id',
  'providerId',
  'mode',
  'mediaType',
  'files',
  'model',
  'prompt',
  'persistedAt'
])

function getTopLevelFileIds(files: unknown): string[] {
  if (!Array.isArray(files)) return []

  return files.flatMap((file) => {
    if (file && typeof file === 'object' && 'id' in file && typeof file.id === 'string') {
      return [file.id]
    }
    return []
  })
}

export function paintingParamsForPersistence(painting: PaintingData): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(painting as unknown as Record<string, unknown>).filter(
      ([key]) => !RESERVED_PAINTING_PARAM_KEYS.has(key) && !isRuntimeKey(key)
    )
  )
}

export function paintingDataToCreateDto(painting: CreatePaintingData): CreatePaintingDto {
  return {
    id: painting.id,
    providerId: painting.providerId,
    mode: painting.mode,
    mediaType: painting.mediaType ?? 'image',
    model: typeof painting.model === 'string' && painting.model.trim() ? painting.model : undefined,
    prompt: painting.prompt ?? '',
    params: paintingParamsForPersistence(painting),
    files: { output: getTopLevelFileIds(painting.files), input: [] }
  }
}
