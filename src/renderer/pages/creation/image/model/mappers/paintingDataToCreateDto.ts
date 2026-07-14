import type { CreatePaintingDto } from '@shared/data/api/schemas/paintings'

import type { PaintingData } from '../types/paintingData'

type CreatePaintingData = PaintingData & {
  providerId: string
}

function getTopLevelFileIds(files: unknown): string[] {
  if (!Array.isArray(files)) return []

  return files.flatMap((file) => {
    if (file && typeof file === 'object' && 'id' in file && typeof file.id === 'string') {
      return [file.id]
    }
    return []
  })
}

export function paintingFileIdsForPersistence(files: unknown): string[] {
  return getTopLevelFileIds(files)
}

export function paintingDataToCreateDto(painting: CreatePaintingData): CreatePaintingDto {
  return {
    id: painting.id,
    providerId: painting.providerId,
    modelId: typeof painting.model === 'string' && painting.model.trim() ? painting.model : undefined,
    prompt: painting.prompt,
    files: {
      output: getTopLevelFileIds(painting.files),
      input: getTopLevelFileIds(painting.inputFiles)
    }
  }
}
