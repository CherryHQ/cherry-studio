import FileManager from '@renderer/services/FileManager'
import type { FileMetadata } from '@renderer/types'
import type { Painting as PaintingRecord } from '@shared/data/types/painting'

import type { PaintingData } from '../types/paintingData'

export async function recordToPaintingData(record: PaintingRecord): Promise<PaintingData> {
  const files = (
    await Promise.all((record.files?.output ?? []).map(async (id) => (await FileManager.getFile(id)) ?? null))
  ).filter((file): file is FileMetadata => Boolean(file))

  return {
    id: record.id,
    providerId: record.providerId,
    model: record.model ?? undefined,
    prompt: record.prompt,
    files,
    ...record.params
  } as PaintingData
}

export function recordsToPaintingDataList(records: PaintingRecord[]): Promise<PaintingData[]> {
  return Promise.all(records.map(recordToPaintingData))
}
