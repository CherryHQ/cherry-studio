import type { recordsToPaintingDataList } from '../paintings/model/mappers/recordToPaintingData'

export type CreationData = Awaited<ReturnType<typeof recordsToPaintingDataList>>[number]
