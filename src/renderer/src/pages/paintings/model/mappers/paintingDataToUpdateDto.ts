import type { UpdatePaintingDto } from '@shared/data/api/schemas/paintings'

import type { PaintingData } from '../types/paintingData'

const RESERVED_PAINTING_DATA_KEYS = new Set(['id', 'providerId', 'mode', 'files', 'model', 'prompt'])

function getTopLevelFileIds(files: unknown): string[] {
  if (!Array.isArray(files)) return []

  return files.flatMap((file) => {
    if (file && typeof file === 'object' && 'id' in file && typeof file.id === 'string') {
      return [file.id]
    }
    return []
  })
}

function getPaintingDataParams(painting: PaintingData): Record<string, unknown> {
  return Object.fromEntries(Object.entries(painting).filter(([key]) => !RESERVED_PAINTING_DATA_KEYS.has(key)))
}

export function paintingDataToUpdateDto(painting: PaintingData): UpdatePaintingDto {
  return {
    model: typeof painting.model === 'string' && painting.model.trim() ? painting.model : undefined,
    prompt: painting.prompt ?? '',
    params: getPaintingDataParams(painting),
    files: { output: getTopLevelFileIds(painting.files), input: [] }
  }
}
