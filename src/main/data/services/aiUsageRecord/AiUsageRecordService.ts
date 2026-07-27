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
import type { Message } from '@shared/data/types/message'
import { parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { sql } from 'drizzle-orm'

import type { ProviderApiKeySnapshot } from '../ProviderService'
import { enrichStatsWithCost } from '../utils/costEnrichment'
import type { AiUsageRecordListServiceQuery } from './recordCursor'
import { getAiUsageRecordStats, getAiUsageRecordTimeline, listAiUsageRecords } from './recordQueries'
import {
  type KeyAttribution,
  resolveKeyAttribution,
  resolveSourceSnapshot,
  type SourceSnapshot
} from './recordSnapshots'

const logger = loggerService.withContext('DataApi:AiUsageRecordService')

const AI_USAGE_RECORD_READ_MODEL_CHANGES = [
  { endpoint: '/ai-usage-records', kind: 'membership' },
  { endpoint: '/ai-usage-records', kind: 'projection' },
  { endpoint: '/ai-usage-records/stats' },
  { endpoint: '/ai-usage-records/timeline' }
] satisfies DataApiDataChangeEffect[]

export type AiUsageRecordMessageInput = Pick<Message, 'id' | 'topicId' | 'role' | 'modelId' | 'stats'>

function hasUsageSignal(stats: NonNullable<Message['stats']>): boolean {
  return (
    stats.inputTokens !== undefined ||
    stats.outputTokens !== undefined ||
    stats.totalTokens !== undefined ||
    stats.cost !== undefined
  )
}

function statsToColumns(stats: NonNullable<Message['stats']>) {
  return {
    inputTokens: stats.inputTokens ?? null,
    outputTokens: stats.outputTokens ?? null,
    totalTokens: stats.totalTokens ?? null,
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
  /** Source captured at request construction; database lookup is compatibility fallback. */
  source?: SourceSnapshot | null
  /** UniqueModelId (`providerId::modelId`). */
  modelId: string
  stats: NonNullable<Message['stats']>
  /** Provider-reported cost candidate from raw usage (for example OpenRouter). */
  providerCostUsd?: number
  /** Exact non-secret credential identity captured at provider selection. */
  apiKeySnapshot?: ProviderApiKeySnapshot
}

export type RecordRequestInput = RecordRequestBase &
  (
    | { modality: 'language'; imageCount?: never }
    | { modality: 'embedding'; imageCount?: never }
    | { modality: 'image'; imageCount: number }
  )

export class AiUsageRecordService {
  async recordFromMessage(message: AiUsageRecordMessageInput): Promise<void> {
    if (message.role !== 'assistant' || !message.stats || !message.modelId) return
    await this.recordRequest({
      requestId: message.id,
      topicId: message.topicId,
      modelId: message.modelId,
      stats: message.stats,
      modality: 'language'
    })
  }

  /**
   * Best-effort upsert for one provider request. Errors are logged and never
   * escape into the AI request or message-persistence path.
   */
  async recordRequest(input: RecordRequestInput): Promise<void> {
    try {
      await this.writeRequest(input)
    } catch (err) {
      logger.error('recordRequest failed', { requestId: input.requestId, modelId: input.modelId, err })
    }
  }

  private async writeRequest(input: RecordRequestInput): Promise<void> {
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
        ? ((await enrichStatsWithCost(input.stats, input.modelId as UniqueModelId, input.providerCostUsd)) ??
          input.stats)
        : input.stats
    if (input.modality !== 'image' && !hasUsageSignal(stats)) return

    const key = await resolveKeyAttribution(providerId, input.apiKeySnapshot)
    const source = await resolveSourceSnapshot(input.source, input.topicId, input.agentSessionId)

    const values = {
      requestId: input.requestId,
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
      ...statsToColumns(stats),
      imageCount: input.modality === 'image' ? input.imageCount : null
    }

    const keepStoredKey = sql`${aiUsageRecordTable.apiKeyAttribution} = 'exact' OR (${aiUsageRecordTable.apiKeyAttribution} <> 'none' AND excluded.api_key_attribution <> 'exact')`
    const keepProviderCost = sql`${aiUsageRecordTable.costSource} = 'provider' AND COALESCE(excluded.cost_source, '') <> 'provider'`

    application
      .get('DbService')
      .getDb()
      .insert(aiUsageRecordTable)
      .values(values)
      .onConflictDoUpdate({
        target: aiUsageRecordTable.requestId,
        set: {
          ...values,
          topicId: sql`COALESCE(excluded.topic_id, ${aiUsageRecordTable.topicId})`,
          providerName: sql`COALESCE(${aiUsageRecordTable.providerName}, excluded.provider_name)`,
          sourceType: sql`COALESCE(${aiUsageRecordTable.sourceType}, excluded.source_type)`,
          sourceId: sql`COALESCE(${aiUsageRecordTable.sourceId}, excluded.source_id)`,
          sourceName: sql`COALESCE(${aiUsageRecordTable.sourceName}, excluded.source_name)`,
          sourceIcon: sql`COALESCE(${aiUsageRecordTable.sourceIcon}, excluded.source_icon)`,
          inputTokens: sql`COALESCE(excluded.input_tokens, ${aiUsageRecordTable.inputTokens})`,
          outputTokens: sql`COALESCE(excluded.output_tokens, ${aiUsageRecordTable.outputTokens})`,
          totalTokens: sql`COALESCE(excluded.total_tokens, ${aiUsageRecordTable.totalTokens})`,
          reasoningTokens: sql`COALESCE(excluded.reasoning_tokens, ${aiUsageRecordTable.reasoningTokens})`,
          imageCount: sql`COALESCE(excluded.image_count, ${aiUsageRecordTable.imageCount})`,
          cost: sql`CASE WHEN ${keepProviderCost} THEN ${aiUsageRecordTable.cost} ELSE COALESCE(excluded.cost, ${aiUsageRecordTable.cost}) END`,
          costCurrency: sql`CASE WHEN ${keepProviderCost} THEN ${aiUsageRecordTable.costCurrency} ELSE COALESCE(excluded.cost_currency, ${aiUsageRecordTable.costCurrency}) END`,
          costSource: sql`CASE WHEN ${keepProviderCost} THEN ${aiUsageRecordTable.costSource} ELSE COALESCE(excluded.cost_source, ${aiUsageRecordTable.costSource}) END`,
          costBreakdown: sql`CASE WHEN ${keepProviderCost} THEN ${aiUsageRecordTable.costBreakdown} ELSE COALESCE(excluded.cost_breakdown, ${aiUsageRecordTable.costBreakdown}) END`,
          pricingSnapshot: sql`CASE WHEN ${keepProviderCost} THEN ${aiUsageRecordTable.pricingSnapshot} ELSE COALESCE(excluded.pricing_snapshot, ${aiUsageRecordTable.pricingSnapshot}) END`,
          timeFirstTokenMs: sql`COALESCE(excluded.time_first_token_ms, ${aiUsageRecordTable.timeFirstTokenMs})`,
          timeCompletionMs: sql`COALESCE(excluded.time_completion_ms, ${aiUsageRecordTable.timeCompletionMs})`,
          timeThinkingMs: sql`COALESCE(excluded.time_thinking_ms, ${aiUsageRecordTable.timeThinkingMs})`,
          noCacheTokens: sql`COALESCE(excluded.no_cache_tokens, ${aiUsageRecordTable.noCacheTokens})`,
          cacheReadTokens: sql`COALESCE(excluded.cache_read_tokens, ${aiUsageRecordTable.cacheReadTokens})`,
          cacheWriteTokens: sql`COALESCE(excluded.cache_write_tokens, ${aiUsageRecordTable.cacheWriteTokens})`,
          apiKeyId: sql`CASE WHEN ${keepStoredKey} THEN ${aiUsageRecordTable.apiKeyId} ELSE excluded.api_key_id END`,
          apiKeyLabel: sql`CASE WHEN ${keepStoredKey} THEN ${aiUsageRecordTable.apiKeyLabel} ELSE excluded.api_key_label END`,
          apiKeyMasked: sql`CASE WHEN ${keepStoredKey} THEN ${aiUsageRecordTable.apiKeyMasked} ELSE excluded.api_key_masked END`,
          apiKeyAttribution: sql`CASE WHEN ${keepStoredKey} THEN ${aiUsageRecordTable.apiKeyAttribution} ELSE excluded.api_key_attribution END`,
          updatedAt: Date.now()
        }
      })
      .run()

    notifyDataApiDataChange(AI_USAGE_RECORD_READ_MODEL_CHANGES)
  }

  /** Public for focused attribution tests and compatibility callers. */
  resolveKeyAttribution(providerId: string, apiKeySnapshot?: ProviderApiKeySnapshot): Promise<KeyAttribution> {
    return resolveKeyAttribution(providerId, apiKeySnapshot)
  }

  list(query: AiUsageRecordListServiceQuery): Promise<AiUsageRecordListResponse> {
    return listAiUsageRecords(query)
  }

  stats(query: AiUsageRecordStatsQuery): Promise<AiUsageRecordStatsResponse> {
    return getAiUsageRecordStats(query)
  }

  timeline(query: AiUsageRecordTimelineQuery): Promise<AiUsageRecordTimelineResponse> {
    return getAiUsageRecordTimeline(query)
  }
}

export const aiUsageRecordService = new AiUsageRecordService()
