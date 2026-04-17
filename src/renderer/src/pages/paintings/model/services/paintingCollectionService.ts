import { dataApiService } from '@data/DataApiService'
import type { PaintingMode } from '@shared/data/types/painting'

import { paintingDataToCreateDto } from '../mappers/paintingDataToCreateDto'
import { paintingDataToUpdateDto } from '../mappers/paintingDataToUpdateDto'
import type { PaintingData } from '../types/paintingData'

type CreatePaintingOptions = {
  providerId: string
  mode: PaintingMode
}

export async function createPaintingRecord(painting: PaintingData, options: CreatePaintingOptions) {
  return dataApiService.post('/paintings', {
    body: paintingDataToCreateDto({
      ...painting,
      providerId: options.providerId,
      mode: options.mode
    })
  })
}

export async function updatePaintingRecord(painting: PaintingData) {
  return dataApiService.patch(`/paintings/${painting.id}` as '/paintings/:id', {
    body: paintingDataToUpdateDto(painting)
  })
}

export async function deletePaintingRecord(paintingId: string) {
  return dataApiService.delete(`/paintings/${paintingId}` as '/paintings/:id')
}

export async function reorderPaintingRecords(orderedIds: string[]) {
  return dataApiService.post('/paintings/reorder', {
    body: { orderedIds }
  })
}
