import { type AiUsageRecordRow, aiUsageRecordTable } from '@data/db/schemas/aiUsageRecord'
import { loggerService } from '@logger'
import type { AiUsageRecordListQuery } from '@shared/data/api/schemas/aiUsageRecord'
import { and, eq, gt, isNotNull, isNull, lt, or, type SQL, type SQLWrapper } from 'drizzle-orm'

const logger = loggerService.withContext('DataApi:AiUsageRecordCursor')

export type AiUsageRecordListServiceQuery = Omit<AiUsageRecordListQuery, 'sortBy' | 'sortOrder'> &
  Partial<Pick<AiUsageRecordListQuery, 'sortBy' | 'sortOrder'>>

export type AiUsageRecordListSortBy = NonNullable<AiUsageRecordListServiceQuery['sortBy']>
export type AiUsageRecordListSortOrder = NonNullable<AiUsageRecordListServiceQuery['sortOrder']>

interface AiUsageRecordMetricCursor {
  value: number | null
  createdAt: number
  id: string
}

function getTokensPerSecond(row: AiUsageRecordRow): number | null {
  if (
    row.outputTokens === null ||
    row.outputTokens <= 0 ||
    row.timeCompletionMs === null ||
    row.timeCompletionMs <= 0
  ) {
    return null
  }

  const generationMs =
    row.timeFirstTokenMs !== null && row.timeFirstTokenMs < row.timeCompletionMs
      ? row.timeCompletionMs - row.timeFirstTokenMs
      : row.timeCompletionMs
  return row.outputTokens / (generationMs / 1000)
}

export function getListSortValue(row: AiUsageRecordRow, sortBy: AiUsageRecordListSortBy): number | null {
  switch (sortBy) {
    case 'createdAt':
      return row.createdAt
    case 'totalTokens':
      return row.totalTokens
    case 'cost':
      return row.cost
    case 'timeFirstTokenMs':
      return row.timeFirstTokenMs
    case 'tokensPerSecond':
      return getTokensPerSecond(row)
  }
}

export function encodeMetricCursor(cursor: AiUsageRecordMetricCursor): string {
  return encodeURIComponent(JSON.stringify([cursor.value, cursor.createdAt, cursor.id]))
}

export function decodeMetricCursor(raw: string | undefined): AiUsageRecordMetricCursor | null {
  if (!raw) return null

  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(raw))
    if (!Array.isArray(parsed) || parsed.length !== 3) throw new Error('invalid tuple')

    const [value, createdAt, id] = parsed
    if (
      (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) ||
      typeof createdAt !== 'number' ||
      !Number.isFinite(createdAt) ||
      typeof id !== 'string' ||
      id.length === 0
    ) {
      throw new Error('invalid boundary')
    }

    return { value, createdAt, id }
  } catch {
    logger.warn('decodeCursor: cursor unparseable, falling back to first page', {
      cursor: raw,
      context: 'ai-usage-record'
    })
    return null
  }
}

export function metricCursorWhere(
  sortExpression: SQLWrapper,
  sortOrder: AiUsageRecordListSortOrder,
  cursor: AiUsageRecordMetricCursor
): SQL {
  const afterTie = or(
    lt(aiUsageRecordTable.createdAt, cursor.createdAt),
    and(eq(aiUsageRecordTable.createdAt, cursor.createdAt), gt(aiUsageRecordTable.id, cursor.id))
  )!

  if (cursor.value === null) {
    return and(isNull(sortExpression), afterTie)!
  }

  const afterMetric = sortOrder === 'asc' ? gt(sortExpression, cursor.value) : lt(sortExpression, cursor.value)
  return or(
    isNull(sortExpression),
    and(isNotNull(sortExpression), or(afterMetric, and(eq(sortExpression, cursor.value), afterTie)))
  )!
}
