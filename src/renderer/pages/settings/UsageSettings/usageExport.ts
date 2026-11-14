import { dataApiService } from '@renderer/data/DataApiService'
import { removeSpecialCharactersForFileName } from '@renderer/utils/file'
import type { AiUsageRecordListSortBy, AiUsageRecordSortOrder } from '@shared/data/api/schemas/aiUsageRecords'
import type { AiUsageRecordEntry, AiUsageRecordModality } from '@shared/data/types/aiUsageRecord'
import { getAiUsageRecordTotalTokens } from '@shared/data/types/aiUsageRecord'
import type { Currency } from '@shared/data/types/model'

import type {
  GroupByKey,
  UsageChartType,
  UsageMetricKey,
  UsageRollupKey,
  UsageTopCount,
  WindowKey
} from './usageAnalytics'
import { getGenerationTokensPerSecond } from './usageAnalytics'
import { toDateKey } from './usageDisplay'

export type UsageRecordExportQuery = Readonly<
  { from: number; to: number; sortOrder: AiUsageRecordSortOrder } & (
    | { sortBy: Exclude<AiUsageRecordListSortBy, 'cost'>; costCurrency?: never }
    | { sortBy: 'cost'; costCurrency: Currency }
  )
>

export type UsageExportContext = Readonly<{
  windowKey: WindowKey
  query: UsageRecordExportQuery
  timezone: string
  locale: string
  exportedAt: string
  display: Readonly<{
    persistedCurrency: Currency | null
    costCurrency: Currency | null
    groupBy: GroupByKey
    chartMetric: UsageMetricKey
    chartType: UsageChartType
    rollup: UsageRollupKey
    topCount: UsageTopCount
    heatmapMetric: UsageMetricKey
  }>
}>

export interface UsageWorkbookLabels {
  usageSheetName: string
  metadataSheetName: string
  columns: readonly string[]
  metadata: readonly { label: string; value: string }[]
  numberPolicyHeader?: string
}

export interface UsageRecordExportResolvers {
  providerName(id: string, snapshot: string | null): string
  modalityLabel(modality: AiUsageRecordModality): string
  modelDisplay(modelId: string | null): string
  sourceLabel(entry: AiUsageRecordEntry): string
}

export class UsageExportError extends Error {
  constructor(
    readonly code: 'DATA_CHANGED' | 'LIMIT_EXCEEDED' | 'INVALID_PAGINATION' | 'ABORTED',
    options?: ErrorOptions
  ) {
    super(code, options)
    this.name = 'UsageExportError'
  }
}

export async function fetchAllUsageEntries(
  query: UsageRecordExportQuery,
  assertValid: () => void,
  onProgress?: (loaded: number, total: number) => void
): Promise<{ entries: AiUsageRecordEntry[]; total: number }> {
  const entries: AiUsageRecordEntry[] = []
  const ids = new Set<string>()
  const cursors = new Set<string>()
  let cursor: string | undefined
  let total: number | undefined
  const checkValid = () => {
    try {
      assertValid()
    } catch (cause) {
      throw new UsageExportError('ABORTED', { cause })
    }
  }

  while (true) {
    checkValid()
    const page = await dataApiService.get('/ai-usage-records', {
      query: { ...query, limit: 200, ...(cursor ? { cursor } : {}) }
    })
    checkValid()
    if (total !== undefined && page.total !== total) throw new UsageExportError('DATA_CHANGED')
    if (!Number.isInteger(page.total) || page.total < 0) {
      throw new UsageExportError('INVALID_PAGINATION')
    }
    if (page.total > 1_048_575) throw new UsageExportError('LIMIT_EXCEEDED')
    total = page.total

    for (const entry of page.items) {
      if (ids.has(entry.id)) throw new UsageExportError('INVALID_PAGINATION')
      ids.add(entry.id)
      entries.push(entry)
    }
    if (page.nextCursor) {
      if (cursors.has(page.nextCursor) || page.items.length === 0 || entries.length >= total) {
        throw new UsageExportError('INVALID_PAGINATION')
      }
      cursors.add(page.nextCursor)
    } else if (entries.length !== total) {
      throw new UsageExportError('DATA_CHANGED')
    }
    onProgress?.(entries.length, total)
    if (!page.nextCursor) return { entries, total }
    cursor = page.nextCursor
  }
}

export const USAGE_EXPORT_COLUMN_IDS = [
  'model',
  'provider',
  'source',
  'createdAt',
  'totalTokens',
  'cost',
  'costCurrency',
  'timeFirstTokenMs',
  'tokensPerSecond',
  'recordId',
  'recordKind',
  'requestCount',
  'providerId',
  'modelId',
  'sourceType',
  'sourceId',
  'modality',
  'inputTokens',
  'outputTokens',
  'reasoningTokens',
  'noCacheTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'imageCount',
  'timeCompletionMs',
  'timeThinkingMs',
  'costSource',
  'apiKeyId',
  'apiKeyLabel',
  'apiKeyMasked',
  'apiKeyAttribution',
  'authMethod'
] as const

function toCellValue(value: unknown): unknown {
  if (value == null) return undefined
  if (typeof value === 'number' && Number.isInteger(value) && Math.abs(value) >= 1e15) {
    return BigInt(value).toString()
  }
  return value
}

export function mapUsageRecordRow(entry: AiUsageRecordEntry, resolve: UsageRecordExportResolvers): unknown[] {
  let totalTokens: number | string | null
  if (entry.totalTokens == null && (entry.inputTokens != null || entry.outputTokens != null)) {
    // Add the original safe integers before any floating-point sum can lose precision.
    const exactTotal = BigInt(entry.inputTokens ?? 0) + BigInt(entry.outputTokens ?? 0)
    totalTokens = exactTotal >= 1_000_000_000_000_000n ? exactTotal.toString() : Number(exactTotal)
  } else {
    totalTokens = getAiUsageRecordTotalTokens(entry)
  }
  return [
    entry.modelName || resolve.modelDisplay(entry.modelId),
    resolve.providerName(entry.providerId ?? '', entry.providerName),
    resolve.sourceLabel(entry),
    entry.createdAt,
    totalTokens,
    entry.cost,
    entry.costCurrency,
    entry.timeFirstTokenMs,
    getGenerationTokensPerSecond(entry) ?? null,
    entry.id,
    entry.recordKind,
    entry.requestCount,
    entry.providerId,
    entry.modelId,
    entry.sourceType,
    entry.sourceId,
    entry.modality,
    entry.inputTokens,
    entry.outputTokens,
    entry.reasoningTokens,
    entry.noCacheTokens,
    entry.cacheReadTokens,
    entry.cacheWriteTokens,
    entry.imageCount,
    entry.timeCompletionMs,
    entry.timeThinkingMs,
    entry.costSource,
    entry.apiKeyId,
    entry.apiKeyLabel,
    entry.apiKeyMasked,
    entry.apiKeyAttribution,
    entry.authMethod
  ].map(toCellValue)
}

export async function buildUsageWorkbookBytes(
  entries: readonly AiUsageRecordEntry[],
  _context: UsageExportContext,
  labels: UsageWorkbookLabels,
  resolve: UsageRecordExportResolvers
): Promise<Uint8Array> {
  if (labels.columns.length !== USAGE_EXPORT_COLUMN_IDS.length) throw new Error('Expected 32 usage columns')
  const XLSX = await import('@e965/xlsx')
  const workbook = XLSX.utils.book_new()
  const usage = XLSX.utils.aoa_to_sheet([
    Array.from(labels.columns),
    ...entries.map((e) => mapUsageRecordRow(e, resolve))
  ])
  const metadataRows = labels.metadata.map(({ label, value }) => [label, value])
  if (labels.numberPolicyHeader !== undefined) metadataRows.unshift([labels.numberPolicyHeader, ''])
  XLSX.utils.book_append_sheet(workbook, usage, labels.usageSheetName)
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(metadataRows), labels.metadataSheetName)
  return new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }))
}

export function buildUsageExportFileStem(
  context: UsageExportContext,
  range: { from: number; to: number },
  exportedAt: Date
): string {
  const date = toDateKey(exportedAt).replaceAll('-', '')
  const time = [exportedAt.getHours(), exportedAt.getMinutes(), exportedAt.getSeconds()]
    .map((value) => String(value).padStart(2, '0'))
    .join('')
  return removeSpecialCharactersForFileName(
    `usage_${context.windowKey}_${toDateKey(new Date(range.from))}_${toDateKey(new Date(range.to))}_${date}-${time}`
  )
}
