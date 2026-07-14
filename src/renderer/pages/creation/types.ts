import type { recordsToPaintingDataList } from './image/model/mappers/recordToPaintingData'

export type CreationData = Awaited<ReturnType<typeof recordsToPaintingDataList>>[number]
