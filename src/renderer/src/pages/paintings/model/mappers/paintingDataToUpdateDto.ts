import type { UpdatePaintingDto } from '@shared/data/api/schemas/paintings'

import type { PaintingData } from '../types/paintingData'
import { paintingFileIdsForPersistence, paintingParamsForPersistence } from './paintingDataToCreateDto'

export function paintingDataToUpdateDto(painting: PaintingData): UpdatePaintingDto {
  return {
    providerId: painting.providerId,
    mode: painting.mode,
    mediaType: painting.mediaType ?? 'image',
    model: typeof painting.model === 'string' && painting.model.trim() ? painting.model : undefined,
    prompt: painting.prompt ?? '',
    params: paintingParamsForPersistence(painting),
    files: {
      output: paintingFileIdsForPersistence(painting.files),
      input: paintingFileIdsForPersistence(painting.inputFiles)
    }
  }
}
