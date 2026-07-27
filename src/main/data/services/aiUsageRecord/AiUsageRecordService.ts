/**
 * Best-effort per-request AI usage records.
 *
 * Records survive deletion of the message, topic, provider, and credential
 * snapshots they describe. Runtime capture and message persistence converge on
 * `requestId`; later writes enrich missing fields without turning the store
 * into an immutable or financially reconcilable ledger.
 */

import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { aiUsageRecordTable } from '@data/db/schemas/aiUsageRecord'
import { loggerService } from '@logger'
import type {
  AiUsageRecordListResponse,
  AiUsageRecordStatsQuery,
  AiUsageRecordStatsResponse,
  AiUsageRecordTimelineQuery,
  AiUsageRecordTimelineResponse
} from '@shared/data/api/schemas/aiUsageRecord'
import type { DataApiDataChangeEffect } from '@shared/data/api/types'
import type { AiUsageRecordSourceType } from '@shared/data/types/aiUsageRecord'
import type { Message } from '@shared/data/types/message'
import { parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { sql } from 'drizzle-orm'

import { enrichStatsWithCost } from '../utils/costEnrichment'
import type { AiUsageRecordListServiceQuery } from './recordCursor'
import { getAiUsageRecordStats, getAiUsageRecordTimeline, listAiUsageRecords } from './recordQueries'
import {
  type KeyAttribution,
  resolveKeyAttribution,
  resolveSourceSnapshot,
  type SourceSnapshot,
  type UsageCredentialReceipt
} from './recordSnapshots'

const logger = loggerService.withContext('DataApi:AiUsageRecordService')

const AI_USAGE_RECORD_READ_MODEL_CHANGES = [
  { endpoint: '/ai-usage-records', kind: 'membership' },
  { endpoint: '/ai-usage-records', kind: 'projection' },
  { endpoint: '/ai-usage-records/stats' },
  { endpoint: '/ai-usage-records/timeline' }
] satisfies DataApiDataChangeEffect[]

export interface AiUsageRecordMessageInput {
  id: Message['id']
  topicId?: string | null
  agentSessionId?: string | null
  role: Message['role']
  modelId: Message['modelId']
  messageSnapshot?: Message['messageSnapshot']
  stats: Message['stats']
}

function hasUsageSignal(stats: NonNullable<Message['stats']>): boolean {
  return (
    stats.inputTokens !== undefined ||
    stats.outputTokens !== undefined ||
    stats.totalTokens !== undefined ||
    stats.cost !== undefined
  )
}

function statsToColumns(stats: NonNullable<Message['stats']>) {
  const derivedTotalTokens =
    stats.totalTokens ??
    (stats.inputTokens !== undefined || stats.outputTokens !== undefined
      ? (stats.inputTokens ?? 0) + (stats.outputTokens ?? 0)
      : null)

  return {
    inputTokens: stats.inputTokens ?? null,
    outputTokens: stats.outputTokens ?? null,
    totalTokens: derivedTotalTokens,
    reasoningTokens: stats.outputTokenDetails?.reasoningTokens ?? null,
    noCacheTokens: stats.inputTokenDetails?.noCacheTokens ?? null,
    cacheReadTokens: stats.inputTokenDetails?.cacheReadTokens ?? null,
    cacheWriteTokens: stats.inputTokenDetails?.cacheWriteTokens ?? null,
    cost: stats.cost ?? null,
    costCurrency: stats.costCurrency ?? null,
    costSource: stats.costSource ?? null,
    costBreakdown: stats.costBreakdown ?? null,
    pricingSnapshot: stats.pricingSnapshot ?? null,
    timeFirstTokenMs: stats.timeFirstTokenMs ?? null,
    timeCompletionMs: stats.timeCompletionMs ?? null,
    timeThinkingMs: stats.timeThinkingMs ?? null
  }
}

interface RecordRequestBase {
  /** Stable request key shared by runtime capture and later persistence. */
  requestId: string
  topicId?: string | null
  agentSessionId?: string | null
  /** Source captured at request construction; database lookup is a source-only fallback. */
  source?: SourceSnapshot | null
  /** UniqueModelId (`providerId::modelId`). */
  modelId: string
  stats: NonNullable<Message['stats']>
  /** Provider-reported cost candidate from raw usage (for example OpenRouter). */
  providerCostUsd?: number
  /** Non-secret credential receipt captured by provider configuration. */
  credentialReceipt?: UsageCredentialReceipt
}

export type RecordRequestInput = RecordRequestBase &
  (
    | { modality: 'language'; imageCount?: never }
    | { modality: 'embedding'; imageCount?: never }
    | { modality: 'image'; imageCount: number }
  )

type RequestCaptureSource = 'runtime' | 'persistence'

function sourceFromMessageSnapshot(message: AiUsageRecordMessageInput): SourceSnapshot | undefined {
  const snapshot = message.messageSnapshot
  if (!snapshot) return undefined

  const type: AiUsageRecordSourceType = message.agentSessionId ? 'agent' : 'assistant'
  return {
    type,
    id: snapshot.id,
    name: snapshot.name,
    icon: snapshot.emoji ?? null
  }
}

export class AiUsageRecordService {
  async recordFromMessage(message: AiUsageRecordMessageInput): Promise<void> {
    if (message.role !== 'assistant' || !message.stats || !message.modelId) return
    this.recordBestEffort(
      {
        requestId: message.id,
        topicId: message.topicId,
        agentSessionId: message.agentSessionId,
        source: sourceFromMessageSnapshot(message),
        modelId: message.modelId,
        stats: message.stats,
        modality: 'language'
      },
      'persistence'
    )
  }

  /**
   * Best-effort upsert for one provider request. Errors are logged and never
   * escape into the AI request or message-persistence path.
   */
  async recordRequest(input: RecordRequestInput): Promise<void> {
    this.recordBestEffort(input, 'runtime')
  }

  private recordBestEffort(input: RecordRequestInput, captureSource: RequestCaptureSource): void {
    try {
      this.writeRequest(input, captureSource)
    } catch (err) {
      logger.error('recordRequest failed', { requestId: input.requestId, modelId: input.modelId, err })
    }
  }

  private writeRequest(input: RecordRequestInput, captureSource: RequestCaptureSource): void {
    if (input.modality === 'image' && input.imageCount <= 0) return

    let providerId: string
    try {
      ;({ providerId } = parseUniqueModelId(input.modelId as `${string}::${string}`))
    } catch {
      logger.warn('recordRequest: unparseable modelId, skipping', { modelId: input.modelId })
      return
    }

    // Enrich before deciding whether the request is empty: a provider may
    // report a charge even when every observed token counter is zero.
    const stats =
      input.stats.cost === undefined && input.modality !== 'image'
        ? (enrichStatsWithCost(input.stats, input.modelId as UniqueModelId, input.providerCostUsd) ?? input.stats)
        : input.stats
    if (input.modality !== 'image' && !hasUsageSignal(stats)) return

    const key = resolveKeyAttribution(providerId, input.credentialReceipt)
    const source = resolveSourceSnapshot(input.source, input.topicId, input.agentSessionId)

    const values = {
      requestId: input.requestId,
      captureSource,
      topicId: input.topicId ?? null,
      providerId,
      providerName: key.providerName ?? null,
      sourceType: source?.type ?? null,
      sourceId: source?.id ?? null,
      sourceName: source?.name ?? null,
      sourceIcon: source?.icon ?? null,
      modelId: input.modelId,
      modality: input.modality,
      apiKeyId: key.keyId ?? null,
      apiKeyLabel: key.label ?? null,
      apiKeyMasked: key.masked ?? null,
      apiKeyAttribution: key.attribution,
      authMethod: key.authMethod ?? null,
      ...statsToColumns(stats),
      imageCount: input.modality === 'image' ? input.imageCount : null
    }

    const preferStoredUsage =
      captureSource === 'persistence' ? sql`${aiUsageRecordTable.captureSource} = 'runtime'` : sql`0`
    const preferStoredSource =
      captureSource === 'persistence' && input.source === undefined
        ? sql`${aiUsageRecordTable.captureSource} = 'runtime'`
        : sql`0`
    const keepStoredCost = sql`(
      (${preferStoredUsage} AND ${aiUsageRecordTable.cost} IS NOT NULL)
      OR (
        ${aiUsageRecordTable.costSource} = 'provider'
        AND COALESCE(excluded.cost_source, '') <> 'provider'
      )
    )`

    application
      .get('DbService')
      .getDb()
      .insert(aiUsageRecordTable)
      .values(values)
      .onConflictDoUpdate({
        target: aiUsageRecordTable.requestId,
        set: {
          ...values,
          captureSource:
            captureSource === 'persistence'
              ? sql`CASE WHEN ${aiUsageRecordTable.captureSource} = 'runtime' THEN 'runtime' ELSE excluded.capture_source END`
              : sql`excluded.capture_source`,
          topicId: sql`COALESCE(excluded.topic_id, ${aiUsageRecordTable.topicId})`,
          providerName: sql`COALESCE(${aiUsageRecordTable.providerName}, excluded.provider_name)`,
          sourceType: sql`CASE WHEN ${preferStoredSource} THEN COALESCE(${aiUsageRecordTable.sourceType}, excluded.source_type) ELSE COALESCE(excluded.source_type, ${aiUsageRecordTable.sourceType}) END`,
          sourceId: sql`CASE WHEN ${preferStoredSource} THEN COALESCE(${aiUsageRecordTable.sourceId}, excluded.source_id) ELSE COALESCE(excluded.source_id, ${aiUsageRecordTable.sourceId}) END`,
          sourceName: sql`CASE WHEN ${preferStoredSource} THEN COALESCE(${aiUsageRecordTable.sourceName}, excluded.source_name) ELSE COALESCE(excluded.source_name, ${aiUsageRecordTable.sourceName}) END`,
          sourceIcon: sql`CASE WHEN ${preferStoredSource} THEN COALESCE(${aiUsageRecordTable.sourceIcon}, excluded.source_icon) ELSE COALESCE(excluded.source_icon, ${aiUsageRecordTable.sourceIcon}) END`,
          inputTokens: sql`CASE WHEN ${preferStoredUsage} THEN COALESCE(${aiUsageRecordTable.inputTokens}, excluded.input_tokens) ELSE COALESCE(excluded.input_tokens, ${aiUsageRecordTable.inputTokens}) END`,
          outputTokens: sql`CASE WHEN ${preferStoredUsage} THEN COALESCE(${aiUsageRecordTable.outputTokens}, excluded.output_tokens) ELSE COALESCE(excluded.output_tokens, ${aiUsageRecordTable.outputTokens}) END`,
          totalTokens: sql`CASE WHEN ${preferStoredUsage} THEN COALESCE(${aiUsageRecordTable.totalTokens}, excluded.total_tokens) ELSE COALESCE(excluded.total_tokens, ${aiUsageRecordTable.totalTokens}) END`,
          reasoningTokens: sql`CASE WHEN ${preferStoredUsage} THEN COALESCE(${aiUsageRecordTable.reasoningTokens}, excluded.reasoning_tokens) ELSE COALESCE(excluded.reasoning_tokens, ${aiUsageRecordTable.reasoningTokens}) END`,
          imageCount: sql`CASE WHEN ${preferStoredUsage} THEN COALESCE(${aiUsageRecordTable.imageCount}, excluded.image_count) ELSE COALESCE(excluded.image_count, ${aiUsageRecordTable.imageCount}) END`,
          cost: sql`CASE WHEN ${keepStoredCost} THEN ${aiUsageRecordTable.cost} ELSE COALESCE(excluded.cost, ${aiUsageRecordTable.cost}) END`,
          costCurrency: sql`CASE WHEN ${keepStoredCost} THEN ${aiUsageRecordTable.costCurrency} ELSE COALESCE(excluded.cost_currency, ${aiUsageRecordTable.costCurrency}) END`,
          costSource: sql`CASE WHEN ${keepStoredCost} THEN ${aiUsageRecordTable.costSource} ELSE COALESCE(excluded.cost_source, ${aiUsageRecordTable.costSource}) END`,
          costBreakdown: sql`CASE WHEN ${keepStoredCost} THEN ${aiUsageRecordTable.costBreakdown} ELSE COALESCE(excluded.cost_breakdown, ${aiUsageRecordTable.costBreakdown}) END`,
          pricingSnapshot: sql`CASE WHEN ${keepStoredCost} THEN ${aiUsageRecordTable.pricingSnapshot} ELSE COALESCE(excluded.pricing_snapshot, ${aiUsageRecordTable.pricingSnapshot}) END`,
          timeFirstTokenMs: sql`CASE WHEN ${preferStoredUsage} THEN COALESCE(${aiUsageRecordTable.timeFirstTokenMs}, excluded.time_first_token_ms) ELSE COALESCE(excluded.time_first_token_ms, ${aiUsageRecordTable.timeFirstTokenMs}) END`,
          timeCompletionMs: sql`CASE WHEN ${preferStoredUsage} THEN COALESCE(${aiUsageRecordTable.timeCompletionMs}, excluded.time_completion_ms) ELSE COALESCE(excluded.time_completion_ms, ${aiUsageRecordTable.timeCompletionMs}) END`,
          timeThinkingMs: sql`CASE WHEN ${preferStoredUsage} THEN COALESCE(${aiUsageRecordTable.timeThinkingMs}, excluded.time_thinking_ms) ELSE COALESCE(excluded.time_thinking_ms, ${aiUsageRecordTable.timeThinkingMs}) END`,
          noCacheTokens: sql`CASE WHEN ${preferStoredUsage} THEN COALESCE(${aiUsageRecordTable.noCacheTokens}, excluded.no_cache_tokens) ELSE COALESCE(excluded.no_cache_tokens, ${aiUsageRecordTable.noCacheTokens}) END`,
          cacheReadTokens: sql`CASE WHEN ${preferStoredUsage} THEN COALESCE(${aiUsageRecordTable.cacheReadTokens}, excluded.cache_read_tokens) ELSE COALESCE(excluded.cache_read_tokens, ${aiUsageRecordTable.cacheReadTokens}) END`,
          cacheWriteTokens: sql`CASE WHEN ${preferStoredUsage} THEN COALESCE(${aiUsageRecordTable.cacheWriteTokens}, excluded.cache_write_tokens) ELSE COALESCE(excluded.cache_write_tokens, ${aiUsageRecordTable.cacheWriteTokens}) END`,
          apiKeyId: captureSource === 'persistence' ? sql`${aiUsageRecordTable.apiKeyId}` : sql`excluded.api_key_id`,
          apiKeyLabel:
            captureSource === 'persistence' ? sql`${aiUsageRecordTable.apiKeyLabel}` : sql`excluded.api_key_label`,
          apiKeyMasked:
            captureSource === 'persistence' ? sql`${aiUsageRecordTable.apiKeyMasked}` : sql`excluded.api_key_masked`,
          apiKeyAttribution:
            captureSource === 'persistence'
              ? sql`${aiUsageRecordTable.apiKeyAttribution}`
              : sql`excluded.api_key_attribution`,
          authMethod:
            captureSource === 'persistence' ? sql`${aiUsageRecordTable.authMethod}` : sql`excluded.auth_method`,
          updatedAt: Date.now()
        }
      })
      .run()

    notifyDataApiDataChange(AI_USAGE_RECORD_READ_MODEL_CHANGES)
  }

  /** Public for focused attribution tests. Missing request-owned proof remains unknown. */
  resolveKeyAttribution(providerId: string, credentialReceipt?: UsageCredentialReceipt): KeyAttribution {
    return resolveKeyAttribution(providerId, credentialReceipt)
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
