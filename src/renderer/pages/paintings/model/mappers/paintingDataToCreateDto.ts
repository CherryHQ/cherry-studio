import type { CreatePaintingDto } from '@shared/data/api/schemas/paintings'

import type { PaintingData } from '../types/paintingData'

type CreatePaintingData = PaintingData & {
  providerId: string
}

export function paintingFileIdsForPersistence(files: PaintingData['files'] | PaintingData['inputFiles']): string[] {
  return (files ?? []).map((file) => file.id)
}

export function paintingDataToCreateDto(painting: CreatePaintingData): CreatePaintingDto {
  return {
    id: painting.id,
    providerId: painting.providerId,
    modelId: typeof painting.model === 'string' && painting.model.trim() ? painting.model : undefined,
    prompt: painting.prompt,
    files: {
      output: paintingFileIdsForPersistence(painting.files),
      input: paintingFileIdsForPersistence(painting.inputFiles)
    }
  }
}
