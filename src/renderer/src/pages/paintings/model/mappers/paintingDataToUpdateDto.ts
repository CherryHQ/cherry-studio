import type { UpdatePaintingDto } from '@shared/data/api/schemas/paintings'

import type { PaintingData } from '../types/paintingData'
import { paintingParamsForPersistence } from './paintingDataToCreateDto'

function getTopLevelFileIds(files: unknown): string[] {
  if (!Array.isArray(files)) return []

  return files.flatMap((file) => {
    if (file && typeof file === 'object' && 'id' in file && typeof file.id === 'string') {
      return [file.id]
    }
    return []
  })
}

export function paintingDataToUpdateDto(painting: PaintingData): UpdatePaintingDto {
  return {
    providerId: painting.providerId,
    mode: painting.mode,
    model: typeof painting.model === 'string' && painting.model.trim() ? painting.model : undefined,
    prompt: painting.prompt ?? '',
    params: paintingParamsForPersistence(painting),
    files: { output: getTopLevelFileIds(painting.files), input: [] }
  }
}
