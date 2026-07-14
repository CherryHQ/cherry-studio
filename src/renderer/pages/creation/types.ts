import type { recordsToPaintingDataList } from './model/recordToPaintingData'

export type CreationData = Awaited<ReturnType<typeof recordsToPaintingDataList>>[number]
