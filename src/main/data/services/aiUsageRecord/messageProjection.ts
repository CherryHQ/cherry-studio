import { isDeepStrictEqual } from 'node:util'

import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { aiUsageRecordTable } from '@data/db/schemas/aiUsageRecord'
import { messageTable } from '@data/db/schemas/message'
import type { DbOrTx } from '@data/db/types'
import type { AiUsageRecordRow } from '@main/data/db/schemas/aiUsageRecord'
import type { MessageStats } from '@shared/data/types/message'
import { and, eq } from 'drizzle-orm'

import type { MessageRef, MessageUsageProjection } from './types'

function sumOptional(
  rows: readonly AiUsageRecordRow[],
  read: (row: AiUsageRecordRow) => number | null
): number | undefined {
  let sawValue = false
  let total = 0
  for (const row of rows) {
    const value = read(row)
    if (value === null) continue
    sawValue = true
    total += value
  }
  return sawValue ? total : undefined
}

export function getMessageUsageProjectionTx(db: DbOrTx, ref: MessageRef): MessageUsageProjection {
  const rows = db
    .select()
    .from(aiUsageRecordTable)
    .where(and(eq(aiUsageRecordTable.messageKind, ref.kind), eq(aiUsageRecordTable.messageId, ref.id)))
    .all()

  const inputTokens = sumOptional(rows, (row) => row.inputTokens)
  const outputTokens = sumOptional(rows, (row) => row.outputTokens)
  const totalTokens = sumOptional(
    rows,
    (row) =>
      row.totalTokens ??
      (row.inputTokens !== null || row.outputTokens !== null ? (row.inputTokens ?? 0) + (row.outputTokens ?? 0) : null)
  )
  const noCacheTokens = sumOptional(rows, (row) => row.noCacheTokens)
  const cacheReadTokens = sumOptional(rows, (row) => row.cacheReadTokens)
  const cacheWriteTokens = sumOptional(rows, (row) => row.cacheWriteTokens)
  const reasoningTokens = sumOptional(rows, (row) => row.reasoningTokens)
  const textTokens = sumOptional(rows, (row) =>
    row.outputTokens !== null ? Math.max(0, row.outputTokens - (row.reasoningTokens ?? 0)) : null
  )
  const costs = new Map<
    string,
    {
      currency: NonNullable<MessageStats['costs']>[number]['currency']
      amount: number
      providerReportedRequestCount: number
      computedRequestCount: number
    }
  >()

  for (const row of rows) {
    if (row.cost === null || row.costCurrency === null || row.costSource === null) continue
    const bucket = costs.get(row.costCurrency) ?? {
      currency: row.costCurrency,
      amount: 0,
      providerReportedRequestCount: 0,
      computedRequestCount: 0
    }
    bucket.amount += row.cost
    if (row.costSource === 'provider') bucket.providerReportedRequestCount += row.requestCount
    else bucket.computedRequestCount += row.requestCount
    costs.set(row.costCurrency, bucket)
  }

  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(noCacheTokens !== undefined || cacheReadTokens !== undefined || cacheWriteTokens !== undefined
      ? {
          inputTokenDetails: {
            ...(noCacheTokens !== undefined ? { noCacheTokens } : {}),
            ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
            ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {})
          }
        }
      : {}),
    ...(textTokens !== undefined || reasoningTokens !== undefined
      ? {
          outputTokenDetails: {
            ...(textTokens !== undefined ? { textTokens } : {}),
            ...(reasoningTokens !== undefined ? { reasoningTokens } : {})
          }
        }
      : {}),
    requestCount: rows.reduce((sum, row) => sum + row.requestCount, 0),
    estimatedRequestCount: rows.reduce(
      (sum, row) => sum + (row.recordKind === 'legacy-aggregate' ? row.requestCount : 0),
      0
    ),
    unpricedRequestCount: rows.reduce((sum, row) => sum + (row.cost === null ? row.requestCount : 0), 0),
    costs: [...costs.values()].sort((left, right) => left.currency.localeCompare(right.currency))
  }
}

function mergeProjection(existing: MessageStats | null, projection: MessageUsageProjection): MessageStats {
  const persisted = (existing ?? {}) as MessageStats & {
    cost?: unknown
    costCurrency?: unknown
    costSource?: unknown
    costBreakdown?: unknown
    pricingSnapshot?: unknown
  }
  const messageOwned = { ...persisted }
  delete messageOwned.inputTokens
  delete messageOwned.outputTokens
  delete messageOwned.totalTokens
  delete messageOwned.inputTokenDetails
  delete messageOwned.outputTokenDetails
  delete messageOwned.requestCount
  delete messageOwned.estimatedRequestCount
  delete messageOwned.unpricedRequestCount
  delete messageOwned.costs
  delete messageOwned.cost
  delete messageOwned.costCurrency
  delete messageOwned.costSource
  delete messageOwned.costBreakdown
  delete messageOwned.pricingSnapshot

  return { ...messageOwned, ...projection }
}

export function rebuildMessageUsageProjectionTx(db: DbOrTx, ref: MessageRef): boolean {
  const projection = getMessageUsageProjectionTx(db, ref)
  if (ref.kind === 'chat') {
    const row = db.select({ stats: messageTable.stats }).from(messageTable).where(eq(messageTable.id, ref.id)).get()
    if (!row) return false
    const nextStats = mergeProjection(row.stats, projection)
    if (isDeepStrictEqual(row.stats, nextStats)) return false
    db.update(messageTable).set({ stats: nextStats }).where(eq(messageTable.id, ref.id)).run()
  } else {
    const row = db
      .select({ stats: agentSessionMessageTable.stats })
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.id, ref.id))
      .get()
    if (!row) return false
    const nextStats = mergeProjection(row.stats, projection)
    if (isDeepStrictEqual(row.stats, nextStats)) return false
    db.update(agentSessionMessageTable).set({ stats: nextStats }).where(eq(agentSessionMessageTable.id, ref.id)).run()
  }
  return true
}
