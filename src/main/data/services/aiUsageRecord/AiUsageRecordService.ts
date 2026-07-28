import { isDeepStrictEqual } from 'node:util'

import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { aiUsageRecordTable, type InsertAiUsageRecordRow } from '@data/db/schemas/aiUsageRecord'
import type { DbOrTx } from '@data/db/types'
import { loggerService } from '@logger'
import type {
  AiUsageRecordListResponse,
  AiUsageRecordStatsQuery,
  AiUsageRecordStatsResponse,
  AiUsageRecordTimelineQuery,
  AiUsageRecordTimelineResponse
} from '@shared/data/api/schemas/aiUsageRecords'
import type { DataApiDataChangeEffect } from '@shared/data/api/types'
import type { AiUsageCostBreakdown, AiUsagePricingSnapshot } from '@shared/data/types/aiUsageRecord'
import { eq } from 'drizzle-orm'

import { computeLanguageCost } from './costComputation'
import { getMessageUsageProjectionTx, rebuildMessageUsageProjectionTx } from './messageProjection'
import type { AiUsageRecordListServiceQuery } from './recordCursor'
import { getAiUsageRecordStats, getAiUsageRecordTimeline, listAiUsageRecords } from './recordQueries'
import type { LegacyAggregateInput, MessageRef, MessageUsageProjection, RecordAiInvocationInput } from './types'

const logger = loggerService.withContext('DataApi:AiUsageRecordService')

const AI_USAGE_RECORD_READ_MODEL_CHANGES = [
  { endpoint: '/ai-usage-records', kind: 'membership' },
  { endpoint: '/ai-usage-records/stats' },
  { endpoint: '/ai-usage-records/timeline' }
] satisfies DataApiDataChangeEffect[]

function optionalCount(value: number | undefined, field: string): number | null {
  if (value === undefined) return null
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a nonnegative safe integer`)
  }
  return value
}

function requiredCount(value: number, field: string): number {
  const validated = optionalCount(value, field)
  if (validated === null) throw new Error(`${field} is required`)
  if (validated === 0) throw new Error(`${field} must be positive`)
  return validated
}

function requiredTimestamp(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a nonnegative safe integer`)
  }
  return value
}

function requiredAmount(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a nonnegative finite number`)
  }
  return value
}

function validatedBreakdown(breakdown: AiUsageCostBreakdown | undefined, field: string): AiUsageCostBreakdown | null {
  if (!breakdown) return null
  for (const [bucket, value] of Object.entries(breakdown)) {
    requiredAmount(value, `${field}.${bucket}`)
  }
  return structuredClone(breakdown)
}

function computedCost(
  input: RecordAiInvocationInput,
  pricing: AiUsagePricingSnapshot | null
): { amount: number; breakdown: AiUsageCostBreakdown } | undefined {
  if (!pricing) return undefined

  if (input.modality === 'image') {
    if (!pricing.perImage || pricing.perImage.unit !== 'image' || input.imageCount === undefined) return undefined
    const amount = input.imageCount * pricing.perImage.price
    return { amount, breakdown: { image: amount } }
  }
  if (input.modality === 'rerank') return undefined

  const usage = input.usage
  if (!usage) return undefined
  const computed = computeLanguageCost(
    {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      inputTokenDetails: {
        noCacheTokens: usage.noCacheTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens
      }
    },
    pricing
  )
  return computed ? { amount: computed.cost, breakdown: computed.breakdown } : undefined
}

function completeProviderBreakdown(
  amount: number,
  breakdown: AiUsageCostBreakdown | undefined
): AiUsageCostBreakdown | null {
  if (!breakdown) return null
  const values = Object.values(breakdown)
  if (values.length === 0 || values.some((value) => !Number.isFinite(value) || value < 0)) return null
  const sum = values.reduce((total, value) => total + value, 0)
  return Math.abs(sum - amount) <= Math.max(1e-9, Math.abs(amount) * 1e-9) ? structuredClone(breakdown) : null
}

function invocationToRow(input: RecordAiInvocationInput): InsertAiUsageRecordRow {
  const { context, usage, metrics } = input
  const providerCost =
    context.trustProviderReportedCost &&
    input.providerCost &&
    Number.isFinite(input.providerCost.amount) &&
    input.providerCost.amount >= 0
      ? input.providerCost
      : undefined
  const localCost = providerCost ? undefined : computedCost(input, context.pricingSnapshot)
  const cost = providerCost?.amount ?? localCost?.amount
  const credential = context.credentialReceipt

  return {
    requestId: input.requestId,
    recordKind: 'invocation',
    requestCount: 1,
    messageKind: context.messageRef?.kind ?? null,
    messageId: context.messageRef?.id ?? null,
    providerId: context.providerId,
    providerName: context.providerName,
    modelId: context.modelId,
    modelName: context.modelName,
    sourceType: context.source?.type ?? null,
    sourceId: context.source?.id ?? null,
    sourceName: context.source?.name ?? null,
    sourceIcon: context.source?.icon ?? null,
    modality: input.modality,
    apiKeyId: credential.attribution === 'explicit' || credential.attribution === 'matched' ? credential.id : null,
    apiKeyLabel:
      credential.attribution === 'explicit' || credential.attribution === 'matched' ? (credential.label ?? null) : null,
    apiKeyMasked:
      credential.attribution === 'explicit' || credential.attribution === 'matched' ? credential.masked : null,
    apiKeyAttribution: credential.attribution,
    authMethod: credential.attribution === 'auth' ? credential.method : null,
    inputTokens: optionalCount(usage?.inputTokens, 'inputTokens'),
    outputTokens: optionalCount(usage?.outputTokens, 'outputTokens'),
    totalTokens: optionalCount(usage?.totalTokens, 'totalTokens'),
    reasoningTokens: optionalCount(usage?.reasoningTokens, 'reasoningTokens'),
    noCacheTokens: optionalCount(usage?.noCacheTokens, 'noCacheTokens'),
    cacheReadTokens: optionalCount(usage?.cacheReadTokens, 'cacheReadTokens'),
    cacheWriteTokens: optionalCount(usage?.cacheWriteTokens, 'cacheWriteTokens'),
    imageCount: input.modality === 'image' ? optionalCount(input.imageCount ?? 0, 'imageCount') : null,
    cost: cost ?? null,
    costCurrency: providerCost?.currency ?? (localCost ? context.pricingSnapshot?.currency : null) ?? null,
    costSource: providerCost ? 'provider' : localCost ? 'computed' : null,
    costBreakdown: providerCost
      ? completeProviderBreakdown(providerCost.amount, providerCost.breakdown)
      : (localCost?.breakdown ?? null),
    pricingSnapshot: context.pricingSnapshot,
    timeFirstTokenMs: optionalCount(metrics?.timeFirstTokenMs, 'timeFirstTokenMs'),
    timeCompletionMs: optionalCount(metrics?.timeCompletionMs, 'timeCompletionMs'),
    timeThinkingMs: optionalCount(metrics?.timeThinkingMs, 'timeThinkingMs'),
    createdAt: requiredTimestamp(input.completedAt, 'completedAt')
  }
}

function legacyToRow(input: LegacyAggregateInput): InsertAiUsageRecordRow {
  const legacyCost = input.cost
    ? {
        amount: requiredAmount(input.cost.amount, 'cost.amount'),
        currency: input.cost.currency,
        source: input.cost.source,
        breakdown: validatedBreakdown(input.cost.breakdown, 'cost.breakdown'),
        pricingSnapshot: input.cost.pricingSnapshot ? structuredClone(input.cost.pricingSnapshot) : null
      }
    : null

  return {
    requestId: input.requestId,
    recordKind: 'legacy-aggregate',
    requestCount: requiredCount(input.requestCount, 'requestCount'),
    messageKind: input.messageRef.kind,
    messageId: input.messageRef.id,
    providerId: input.providerId ?? null,
    providerName: input.providerName ?? null,
    modelId: input.modelId ?? null,
    modelName: input.modelName ?? null,
    sourceType: input.source?.type ?? null,
    sourceId: input.source?.id ?? null,
    sourceName: input.source?.name ?? null,
    sourceIcon: input.source?.icon ?? null,
    modality: input.modality ?? 'language',
    apiKeyId: null,
    apiKeyLabel: null,
    apiKeyMasked: null,
    apiKeyAttribution: 'unknown',
    authMethod: null,
    inputTokens: optionalCount(input.usage?.inputTokens, 'inputTokens'),
    outputTokens: optionalCount(input.usage?.outputTokens, 'outputTokens'),
    totalTokens: optionalCount(input.usage?.totalTokens, 'totalTokens'),
    reasoningTokens: optionalCount(input.usage?.reasoningTokens, 'reasoningTokens'),
    noCacheTokens: optionalCount(input.usage?.noCacheTokens, 'noCacheTokens'),
    cacheReadTokens: optionalCount(input.usage?.cacheReadTokens, 'cacheReadTokens'),
    cacheWriteTokens: optionalCount(input.usage?.cacheWriteTokens, 'cacheWriteTokens'),
    imageCount: input.modality === 'image' ? 0 : null,
    cost: legacyCost?.amount ?? null,
    costCurrency: legacyCost?.currency ?? null,
    costSource: legacyCost?.source ?? null,
    costBreakdown: legacyCost?.breakdown ?? null,
    pricingSnapshot: legacyCost?.pricingSnapshot ?? null,
    timeFirstTokenMs: null,
    timeCompletionMs: null,
    timeThinkingMs: null,
    createdAt: requiredTimestamp(input.createdAt, 'createdAt')
  }
}

function comparableRow(row: InsertAiUsageRecordRow): Omit<InsertAiUsageRecordRow, 'id'> {
  const comparable = { ...row }
  delete comparable.id
  return comparable
}

function insertRowsTx(
  db: DbOrTx,
  rows: readonly InsertAiUsageRecordRow[],
  warnOnConflict: boolean
): { inserted: number; affectedMessages: MessageRef[] } {
  let inserted = 0
  const affectedMessages = new Map<string, MessageRef>()
  for (const row of rows) {
    if (row.messageKind && row.messageId) {
      const ref = { kind: row.messageKind, id: row.messageId }
      affectedMessages.set(`${ref.kind}:${ref.id}`, ref)
    }
    const result = db.insert(aiUsageRecordTable).values(row).onConflictDoNothing().run()
    if (result.changes === 0) {
      if (warnOnConflict) {
        const existing = db
          .select()
          .from(aiUsageRecordTable)
          .where(eq(aiUsageRecordTable.requestId, row.requestId))
          .get()
        if (existing && !isDeepStrictEqual(comparableRow(existing), comparableRow(row))) {
          logger.warn('duplicate requestId has a different immutable payload', { requestId: row.requestId })
        }
      }
      continue
    }
    inserted += 1
  }

  for (const ref of affectedMessages.values()) rebuildMessageUsageProjectionTx(db, ref)
  return { inserted, affectedMessages: [...affectedMessages.values()] }
}

function messageReadModelEffects(refs: readonly MessageRef[]): DataApiDataChangeEffect[] {
  const chatIds = refs.filter((ref) => ref.kind === 'chat').map((ref) => ref.id)
  const agentIds = refs.filter((ref) => ref.kind === 'agent-session').map((ref) => ref.id)
  return [
    ...(chatIds.length > 0
      ? [
          { endpoint: '/topics/:topicId/messages', kind: 'projection', entityIds: chatIds } as const,
          { endpoint: '/messages/:id', entityIds: chatIds } as const
        ]
      : []),
    ...(agentIds.length > 0
      ? [
          { endpoint: '/agent-sessions/:sessionId/messages', kind: 'projection', entityIds: agentIds } as const,
          { endpoint: '/agent-sessions/:sessionId/messages/:messageId', entityIds: agentIds } as const
        ]
      : [])
  ]
}

export class AiUsageRecordService {
  recordInvocation(input: RecordAiInvocationInput): void {
    this.recordInvocations([input])
  }

  recordInvocations(inputs: readonly RecordAiInvocationInput[]): void {
    if (inputs.length === 0) return
    try {
      const result = application
        .get('DbService')
        .withWriteTx((tx) => insertRowsTx(tx, inputs.map(invocationToRow), true))
      if (result.inserted === 0) return
      notifyDataApiDataChange([
        ...AI_USAGE_RECORD_READ_MODEL_CHANGES,
        ...messageReadModelEffects(result.affectedMessages)
      ])
    } catch (err) {
      logger.error('recordInvocations failed', err as Error, { requestIds: inputs.map((input) => input.requestId) })
    }
  }

  getMessageUsageProjection(ref: MessageRef): MessageUsageProjection {
    return getMessageUsageProjectionTx(application.get('DbService').getDb(), ref)
  }

  refreshMessageProjection(ref: MessageRef): void {
    try {
      const changed = application.get('DbService').withWriteTx((tx) => rebuildMessageUsageProjectionTx(tx, ref))
      if (changed) notifyDataApiDataChange(messageReadModelEffects([ref]))
    } catch (err) {
      logger.error('refreshMessageProjection failed', err as Error, ref)
    }
  }

  recordLegacyAggregatesTx(db: DbOrTx, inputs: readonly LegacyAggregateInput[]): number {
    return insertRowsTx(db, inputs.map(legacyToRow), false).inserted
  }

  list(query: AiUsageRecordListServiceQuery): AiUsageRecordListResponse {
    return listAiUsageRecords(query)
  }

  stats(query: AiUsageRecordStatsQuery): AiUsageRecordStatsResponse {
    return getAiUsageRecordStats(query)
  }

  timeline(query: AiUsageRecordTimelineQuery): AiUsageRecordTimelineResponse {
    return getAiUsageRecordTimeline(query)
  }
}

export const aiUsageRecordService = new AiUsageRecordService()
