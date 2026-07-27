import { type AiUsageRecordRow, aiUsageRecordTable } from '@data/db/schemas/aiUsageRecord'
import type {
  AiUsageRecordGroupBy,
  AiUsageRecordGroupIdentity,
  AiUsageRecordStatsGroupIdentity
} from '@shared/data/api/schemas/aiUsageRecord'
import type {
  AiUsageRecordAttribution,
  AiUsageRecordEntry,
  AiUsageRecordSourceType
} from '@shared/data/types/aiUsageRecord'
import { sql } from 'drizzle-orm'

import { timestampToISO } from '../utils/rowMappers'

export type GroupDimension = AiUsageRecordGroupBy | undefined

const nullKeyAttributionClass = sql<string | null>`CASE
  WHEN ${aiUsageRecordTable.apiKeyId} IS NULL
  THEN ${aiUsageRecordTable.apiKeyAttribution}
  ELSE NULL
END`

export function rowToRecord(row: AiUsageRecordRow): AiUsageRecordEntry {
  return {
    id: row.id,
    requestId: row.requestId,
    topicId: row.topicId,
    providerId: row.providerId,
    providerName: row.providerName,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    sourceName: row.sourceName,
    sourceIcon: row.sourceIcon,
    modelId: row.modelId,
    modality: row.modality,
    apiKeyId: row.apiKeyId,
    apiKeyLabel: row.apiKeyLabel,
    apiKeyMasked: row.apiKeyMasked,
    apiKeyAttribution: row.apiKeyAttribution,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    totalTokens: row.totalTokens,
    reasoningTokens: row.reasoningTokens,
    noCacheTokens: row.noCacheTokens,
    cacheReadTokens: row.cacheReadTokens,
    cacheWriteTokens: row.cacheWriteTokens,
    imageCount: row.imageCount,
    cost: row.cost,
    costCurrency: row.costCurrency,
    costSource: row.costSource,
    costBreakdown: row.costBreakdown,
    pricingSnapshot: row.pricingSnapshot,
    timeFirstTokenMs: row.timeFirstTokenMs,
    timeCompletionMs: row.timeCompletionMs,
    timeThinkingMs: row.timeThinkingMs,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

export function groupIdentityColumns(groupBy: GroupDimension) {
  switch (groupBy) {
    case 'provider':
      return [aiUsageRecordTable.providerId]
    case 'apiKey':
      // `auth` and `none` both have a NULL key id but are distinct buckets.
      // Exact/rotation rows for one concrete key still collapse together.
      return [aiUsageRecordTable.providerId, aiUsageRecordTable.apiKeyId, nullKeyAttributionClass]
    case 'model':
      return [aiUsageRecordTable.providerId, aiUsageRecordTable.modelId]
    case 'source':
      return [aiUsageRecordTable.sourceType, aiUsageRecordTable.sourceId]
    default:
      return []
  }
}

export function groupIdentitySelect(groupBy: GroupDimension) {
  const bySource = groupBy === 'source'
  const byProvider = groupBy !== undefined && !bySource
  const byApiKey = groupBy === 'apiKey'

  return {
    providerId: byProvider ? aiUsageRecordTable.providerId : sql<string | null>`NULL`,
    providerName: byProvider ? sql<string | null>`max(${aiUsageRecordTable.providerName})` : sql<string | null>`NULL`,
    sourceType: bySource ? aiUsageRecordTable.sourceType : sql<AiUsageRecordSourceType | null>`NULL`,
    sourceId: bySource ? aiUsageRecordTable.sourceId : sql<string | null>`NULL`,
    sourceName: bySource ? sql<string | null>`max(${aiUsageRecordTable.sourceName})` : sql<string | null>`NULL`,
    sourceIcon: bySource ? sql<string | null>`max(${aiUsageRecordTable.sourceIcon})` : sql<string | null>`NULL`,
    apiKeyId: byApiKey ? aiUsageRecordTable.apiKeyId : sql<string | null>`NULL`,
    modelId: groupBy === 'model' ? aiUsageRecordTable.modelId : sql<string | null>`NULL`,
    apiKeyLabel: byApiKey ? sql<string | null>`max(${aiUsageRecordTable.apiKeyLabel})` : sql<string | null>`NULL`,
    apiKeyMasked: byApiKey ? sql<string | null>`max(${aiUsageRecordTable.apiKeyMasked})` : sql<string | null>`NULL`,
    apiKeyAttribution: byApiKey
      ? sql<string>`CASE
          WHEN ${aiUsageRecordTable.apiKeyId} IS NULL
          THEN max(${aiUsageRecordTable.apiKeyAttribution})
          ELSE CASE min(CASE ${aiUsageRecordTable.apiKeyAttribution}
            WHEN 'exact' THEN 4
            WHEN 'rotation' THEN 3
            ELSE 1
          END)
            WHEN 4 THEN 'exact'
            WHEN 3 THEN 'rotation'
            ELSE 'none'
          END
        END`
      : sql<string | null>`NULL`
  }
}

export type GroupIdentityRow = {
  [K in keyof ReturnType<typeof groupIdentitySelect>]: string | null
}

export function toGroupIdentity(row: GroupIdentityRow, groupBy: GroupDimension): AiUsageRecordGroupIdentity {
  if (groupBy === undefined) {
    return {}
  }

  return {
    ...(groupBy === 'source'
      ? {
          sourceType: row.sourceType as AiUsageRecordSourceType | null,
          sourceId: row.sourceId,
          sourceName: row.sourceName,
          sourceIcon: row.sourceIcon
        }
      : {
          providerId: row.providerId as string,
          providerName: row.providerName
        }),
    ...(groupBy === 'apiKey'
      ? {
          apiKeyId: row.apiKeyId,
          apiKeyLabel: row.apiKeyLabel,
          apiKeyMasked: row.apiKeyMasked,
          apiKeyAttribution: row.apiKeyAttribution as AiUsageRecordAttribution
        }
      : {}),
    ...(groupBy === 'model' ? { modelId: row.modelId } : {})
  }
}

export function toStatsGroupIdentity(
  row: GroupIdentityRow,
  groupBy: AiUsageRecordGroupBy
): AiUsageRecordStatsGroupIdentity {
  switch (groupBy) {
    case 'provider':
      return {
        groupBy,
        providerId: row.providerId as string,
        providerName: row.providerName
      }
    case 'apiKey':
      return {
        groupBy,
        providerId: row.providerId as string,
        providerName: row.providerName,
        apiKeyId: row.apiKeyId,
        apiKeyLabel: row.apiKeyLabel,
        apiKeyMasked: row.apiKeyMasked,
        apiKeyAttribution: row.apiKeyAttribution as AiUsageRecordAttribution
      }
    case 'model':
      return {
        groupBy,
        providerId: row.providerId as string,
        providerName: row.providerName,
        modelId: row.modelId as string
      }
    case 'source':
      return {
        groupBy,
        sourceType: row.sourceType as AiUsageRecordSourceType | null,
        sourceId: row.sourceId,
        sourceName: row.sourceName,
        sourceIcon: row.sourceIcon
      }
  }
}
