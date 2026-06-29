/**
 * Usage Ledger Service - durable per-message usage/cost records
 *
 * The ledger is the billing source of truth: append-only snapshots that
 * survive deletion of the message, topic, provider, and API key they
 * describe (the table has no foreign keys by design).
 *
 * Rows are recorded from two converging sources: a billing funnel in the AI
 * pipeline (`AiService.billingHookPart`, plus the `embedMany`/`generateImage`
 * call sites) fires `recordRequest` per request, and post-commit data-layer
 * hooks (`MessageService.update`, `TemporaryChatService.persist`,
 * `AgentSessionMessageService.saveMessage`) fire `recordFromMessage` /
 * `recordRequest`. Both paths upsert on the same `messageId`.
 *
 * API key attribution is resolved here, best-effort, from ProviderService
 * state at write time (the pipeline does not thread the chosen key through):
 * - exactly one enabled key        → `exact` (rotation always returns it)
 * - multiple enabled keys          → `rotation` (round-robin pointer; with
 *   concurrent requests to the same provider, or unrelated rotation callers
 *   like model-list refresh, the pointer may have moved — treat as
 *   "probable", not guaranteed)
 * - IAM / keyless OAuth credential → `auth`
 * - otherwise                      → `none` (no keys, pointer lost on
 *   restart, or key deleted before persist)
 *
 * Upsert semantics: usage/cost columns are last-write-wins; key-identity
 * columns keep the EARLIEST non-`none` attribution (it was resolved closest
 * to request time and is the most trustworthy).
 */

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { assistantTable } from '@data/db/schemas/assistant'
import { topicTable } from '@data/db/schemas/topic'
import { type UsageLedgerRow, usageLedgerTable } from '@data/db/schemas/usageLedger'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { loggerService } from '@logger'
import type {
  UsageLedgerCostBackfillPreviewResponse,
  UsageLedgerCostBackfillQuery,
  UsageLedgerCostBackfillRunResponse,
  UsageLedgerListQuery,
  UsageLedgerListResponse,
  UsageLedgerStatsBucket,
  UsageLedgerStatsQuery,
  UsageLedgerStatsResponse,
  UsageLedgerTimelineQuery,
  UsageLedgerTimelineResponse
} from '@shared/data/api/schemas/usageLedger'
import type { Message, MessageStats } from '@shared/data/types/message'
import { parseUniqueModelId, type RuntimeModelPricing, type UniqueModelId } from '@shared/data/types/model'
import type {
  UsageLedgerAttribution,
  UsageLedgerEntry,
  UsageLedgerModality,
  UsageLedgerSourceType
} from '@shared/data/types/usageLedger'
import { maskApiKeyForSnapshot } from '@shared/utils/api'
import type { SQL } from 'drizzle-orm'
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm'

import { providerService } from './ProviderService'
import { computeStatsCostSnapshot, enrichStatsWithCost } from './utils/costEnrichment'
import { timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:UsageLedgerService')

/** The message fields the ledger needs — callers may pass a full `Message`. */
export type UsageLedgerMessageInput = Pick<Message, 'id' | 'topicId' | 'role' | 'modelId' | 'stats'>

interface KeyAttribution {
  attribution: UsageLedgerAttribution
  providerName?: string
  keyId?: string
  label?: string
  masked?: string
}

function rowToEntry(row: UsageLedgerRow): UsageLedgerEntry {
  return {
    id: row.id,
    messageId: row.messageId,
    topicId: row.topicId,
    providerId: row.providerId,
    providerName: row.providerName,
    sourceType: row.sourceType as UsageLedgerSourceType | null,
    sourceId: row.sourceId,
    sourceName: row.sourceName,
    sourceIcon: row.sourceIcon,
    modelId: row.modelId,
    modality: row.modality as UsageLedgerModality,
    apiKeyId: row.apiKeyId,
    apiKeyLabel: row.apiKeyLabel,
    apiKeyMasked: row.apiKeyMasked,
    apiKeyAttribution: row.apiKeyAttribution as UsageLedgerAttribution,
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
    costSource: row.costSource as UsageLedgerEntry['costSource'],
    costBreakdown: row.costBreakdown ?? null,
    pricingSnapshot: row.pricingSnapshot ?? null,
    timeFirstTokenMs: row.timeFirstTokenMs,
    timeCompletionMs: row.timeCompletionMs,
    timeThinkingMs: row.timeThinkingMs,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

async function readProviderNameMap(): Promise<Map<string, string>> {
  const rows = await application
    .get('DbService')
    .getDb()
    .select({ providerId: userProviderTable.providerId, name: userProviderTable.name })
    .from(userProviderTable)

  return new Map(rows.map((row) => [row.providerId, row.name]))
}

function resolveProviderNameSnapshot(
  providerId: string,
  snapshotName: string | null,
  providerNames: Map<string, string>
): string | null {
  if (snapshotName && snapshotName !== providerId) {
    return snapshotName
  }

  return providerNames.get(providerId) ?? snapshotName
}

type SourceSnapshot = {
  type: UsageLedgerSourceType
  id: string
  name: string | null
  icon: string | null
}

type UsageLedgerListServiceQuery = Omit<UsageLedgerListQuery, 'sortBy' | 'sortDirection'> &
  Partial<Pick<UsageLedgerListQuery, 'sortBy' | 'sortDirection'>>

async function resolveTopicSource(topicId: string | null | undefined): Promise<SourceSnapshot | null> {
  if (!topicId) return null

  const db = application.get('DbService').getDb()
  const [row] = await db
    .select({
      assistantId: topicTable.assistantId,
      assistantName: assistantTable.name,
      assistantIcon: assistantTable.emoji
    })
    .from(topicTable)
    .leftJoin(assistantTable, eq(topicTable.assistantId, assistantTable.id))
    .where(eq(topicTable.id, topicId))
    .limit(1)

  return row?.assistantId
    ? { type: 'assistant', id: row.assistantId, name: row.assistantName ?? null, icon: row.assistantIcon ?? null }
    : null
}

async function resolveAgentSessionSource(sessionId: string | null | undefined): Promise<SourceSnapshot | null> {
  if (!sessionId) return null

  const db = application.get('DbService').getDb()
  const [row] = await db
    .select({
      agentId: agentSessionTable.agentId,
      agentName: agentTable.name,
      agentConfiguration: agentTable.configuration
    })
    .from(agentSessionTable)
    .leftJoin(agentTable, eq(agentSessionTable.agentId, agentTable.id))
    .where(eq(agentSessionTable.id, sessionId))
    .limit(1)

  return row?.agentId
    ? {
        type: 'agent',
        id: row.agentId,
        name: row.agentName ?? null,
        icon: getAgentAvatar(row.agentConfiguration) ?? null
      }
    : null
}

function getAgentAvatar(configuration: unknown): string | undefined {
  if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) return undefined
  const avatar = (configuration as { avatar?: unknown }).avatar
  return typeof avatar === 'string' ? avatar : undefined
}

/** Provider-level credentials that never flow through the apiKeys array. */
const AUTH_CREDENTIAL_TYPES: ReadonlySet<string> = new Set(['iam-aws', 'iam-gcp', 'iam-azure'])

/** True when the stats blob carries something worth billing. */
function hasUsageSignal(stats: NonNullable<Message['stats']>): boolean {
  return (
    stats.inputTokens !== undefined ||
    stats.outputTokens !== undefined ||
    stats.totalTokens !== undefined ||
    stats.cost !== undefined
  )
}

/** Project the persisted `MessageStats` onto the ledger's usage/cost columns. */
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

type CostBackfillRow = Pick<
  UsageLedgerRow,
  | 'id'
  | 'inputTokens'
  | 'outputTokens'
  | 'totalTokens'
  | 'reasoningTokens'
  | 'noCacheTokens'
  | 'cacheReadTokens'
  | 'cacheWriteTokens'
>

type CostBackfillUpdate = {
  id: string
  cost: number
  costCurrency: NonNullable<MessageStats['costCurrency']>
  costBreakdown: NonNullable<MessageStats['costBreakdown']>
  pricingSnapshot: NonNullable<MessageStats['pricingSnapshot']>
}

interface CostBackfillPlan extends UsageLedgerCostBackfillPreviewResponse {
  updates: CostBackfillUpdate[]
}

function buildStatsFromLedgerRow(row: CostBackfillRow): MessageStats {
  const inputTokenDetails: NonNullable<MessageStats['inputTokenDetails']> = {}
  if (row.noCacheTokens != null) inputTokenDetails.noCacheTokens = row.noCacheTokens
  if (row.cacheReadTokens != null) inputTokenDetails.cacheReadTokens = row.cacheReadTokens
  if (row.cacheWriteTokens != null) inputTokenDetails.cacheWriteTokens = row.cacheWriteTokens

  const outputTokenDetails: NonNullable<MessageStats['outputTokenDetails']> = {}
  if (row.reasoningTokens != null) outputTokenDetails.reasoningTokens = row.reasoningTokens

  return {
    ...(row.inputTokens != null ? { inputTokens: row.inputTokens } : {}),
    ...(row.outputTokens != null ? { outputTokens: row.outputTokens } : {}),
    ...(row.totalTokens != null ? { totalTokens: row.totalTokens } : {}),
    ...(Object.keys(inputTokenDetails).length > 0 ? { inputTokenDetails } : {}),
    ...(Object.keys(outputTokenDetails).length > 0 ? { outputTokenDetails } : {})
  }
}

function buildCostBackfillBaseConditions(query: UsageLedgerCostBackfillQuery): SQL[] {
  const conditions: SQL[] = [
    eq(usageLedgerTable.modelId, query.modelId),
    inArray(usageLedgerTable.modality, ['language', 'embedding'])
  ]
  if (query.from !== undefined) conditions.push(gte(usageLedgerTable.createdAt, query.from))
  if (query.to !== undefined) conditions.push(lte(usageLedgerTable.createdAt, query.to))
  return conditions
}

function addEstimatedCost(
  totals: Map<string, number>,
  currency: NonNullable<MessageStats['costCurrency']>,
  cost: number
): void {
  totals.set(currency, (totals.get(currency) ?? 0) + cost)
}

export interface RecordRequestInput {
  /**
   * Ledger row key. For chat requests this is the assistant message id (the
   * same key the `MessageService.update` hook writes, so the two capture
   * paths converge on one row); for stateless requests (API gateway,
   * translate, rename) it is a per-request id.
   */
  id: string
  topicId?: string | null
  agentSessionId?: string | null
  source?: SourceSnapshot | null
  /** UniqueModelId ("providerId::modelId"). */
  modelId: string
  stats: NonNullable<Message['stats']>
  /** Provider-reported cost candidate from raw usage (e.g. OpenRouter). */
  providerCostUsd?: number
  /** Request kind; defaults to `language`. */
  modality?: UsageLedgerModality
  /** Generated image count (modality `image`). */
  imageCount?: number
}

export class UsageLedgerService {
  /**
   * Record (upsert) the ledger row for an assistant message that landed
   * token stats. Delegates to {@link recordRequest} with the message id as
   * the row key.
   */
  async recordFromMessage(message: UsageLedgerMessageInput): Promise<void> {
    if (message.role !== 'assistant') return
    if (!message.stats || !message.modelId) return
    await this.recordRequest({
      id: message.id,
      topicId: message.topicId,
      modelId: message.modelId,
      stats: message.stats
    })
  }

  /**
   * Record (upsert) the ledger row for one billable AI request. Idempotent
   * on the row key: usage/cost columns are last-write-wins on re-records
   * (retries, continue-after-tool-approval, funnel + persistence-hook
   * convergence); key-identity columns keep the earliest non-`none`
   * attribution; `topicId` never regresses to NULL. No-op for stats without
   * any usage signal. Cost is enriched here (pricing/provider lookup) when
   * the caller's stats don't already carry one.
   *
   * Known limitation: a continue-after-tool-approval run restarts the
   * pipeline's usage accumulator, so a re-record reflects the continuation
   * leg only — the same under-count is visible on the message itself.
   * Fixing that belongs upstream in the stream pipeline, not here.
   *
   * Best-effort by contract: callers fire-and-forget; failures must never
   * disrupt the request or message persistence.
   */
  async recordRequest(input: RecordRequestInput): Promise<void> {
    const modality = input.modality ?? 'language'
    if (!hasUsageSignal(input.stats) && !input.imageCount) return

    let providerId: string
    try {
      ;({ providerId } = parseUniqueModelId(input.modelId as `${string}::${string}`))
    } catch {
      logger.warn('recordRequest: unparseable modelId, skipping', { modelId: input.modelId })
      return
    }

    // Stateless requests skip the message-persistence cost step — resolve
    // cost here when absent. Already-enriched stats pass through untouched.
    // Image requests are priced per image at the call site (the token-based
    // enrichment doesn't apply).
    const stats =
      input.stats.cost === undefined && modality !== 'image'
        ? ((await enrichStatsWithCost(input.stats, input.modelId as UniqueModelId, input.providerCostUsd)) ??
          input.stats)
        : input.stats

    const key = await this.resolveKeyAttribution(providerId)
    const source =
      input.source ??
      (await resolveTopicSource(input.topicId)) ??
      (await resolveAgentSessionSource(input.agentSessionId))

    const values = {
      messageId: input.id,
      topicId: input.topicId ?? null,
      providerId,
      providerName: key.providerName ?? null,
      sourceType: source?.type ?? null,
      sourceId: source?.id ?? null,
      sourceName: source?.name ?? null,
      sourceIcon: source?.icon ?? null,
      modelId: input.modelId,
      modality,
      apiKeyId: key.keyId ?? null,
      apiKeyLabel: key.label ?? null,
      apiKeyMasked: key.masked ?? null,
      apiKeyAttribution: key.attribution,
      ...statsToColumns(stats),
      imageCount: input.imageCount ?? null
    }

    // In the DO UPDATE branch, an unqualified/table-qualified column reads the
    // EXISTING row and `excluded.*` reads the proposed insert. Key-identity
    // columns keep the stored attribution unless it is 'none' — the first
    // resolution happened closest to request time and is the most accurate;
    // a later 'none' (pointer lost on restart) must not downgrade it.
    const keepStored = sql`${usageLedgerTable.apiKeyAttribution} <> 'none'`
    await application.get('DbService').withWriteTx(async (tx) => {
      await tx
        .insert(usageLedgerTable)
        .values(values)
        .onConflictDoUpdate({
          target: usageLedgerTable.messageId,
          set: {
            ...values,
            // The billing funnel records without topic context; the
            // persistence hook records with it. Whichever lands second must
            // not erase the topic.
            topicId: sql`COALESCE(excluded.topic_id, ${usageLedgerTable.topicId})`,
            providerName: sql`COALESCE(${usageLedgerTable.providerName}, excluded.provider_name)`,
            sourceType: sql`COALESCE(${usageLedgerTable.sourceType}, excluded.source_type)`,
            sourceId: sql`COALESCE(${usageLedgerTable.sourceId}, excluded.source_id)`,
            sourceName: sql`COALESCE(${usageLedgerTable.sourceName}, excluded.source_name)`,
            sourceIcon: sql`COALESCE(${usageLedgerTable.sourceIcon}, excluded.source_icon)`,
            apiKeyId: sql`CASE WHEN ${keepStored} THEN ${usageLedgerTable.apiKeyId} ELSE excluded.api_key_id END`,
            apiKeyLabel: sql`CASE WHEN ${keepStored} THEN ${usageLedgerTable.apiKeyLabel} ELSE excluded.api_key_label END`,
            apiKeyMasked: sql`CASE WHEN ${keepStored} THEN ${usageLedgerTable.apiKeyMasked} ELSE excluded.api_key_masked END`,
            apiKeyAttribution: sql`CASE WHEN ${keepStored} THEN ${usageLedgerTable.apiKeyAttribution} ELSE excluded.api_key_attribution END`,
            // $onUpdateFn does not fire on conflict-update paths — stamp explicitly.
            updatedAt: Date.now()
          }
        })
    })
  }

  /**
   * Best-effort API key attribution for a provider at write time.
   * See the class doc for the exact/rotation/auth/none semantics.
   */
  async resolveKeyAttribution(providerId: string): Promise<KeyAttribution> {
    try {
      const provider = await providerService.getByProviderId(providerId)
      const authType = provider.authType
      const allKeysCount = provider.apiKeys.length
      const providerName = provider.name
      if (AUTH_CREDENTIAL_TYPES.has(authType)) {
        return { attribution: 'auth', providerName }
      }

      let allKeys: Awaited<ReturnType<typeof providerService.getApiKeys>>
      try {
        allKeys = allKeysCount > 0 ? await providerService.getApiKeys(providerId) : []
      } catch {
        return { attribution: 'none', providerName }
      }
      const enabled = allKeys.filter((k) => k.isEnabled)

      if (enabled.length === 0) {
        // OAuth providers without API keys authenticate via their token
        // (e.g. claude-code CLI login); plain api-key providers with no keys
        // (local endpoints) are simply unattributable.
        return authType === 'oauth' ? { attribution: 'auth', providerName } : { attribution: 'none', providerName }
      }

      if (enabled.length === 1) {
        // Rotation short-circuits on a single enabled key — deterministic.
        const k = enabled[0]
        return { attribution: 'exact', providerName, keyId: k.id, label: k.label, masked: maskApiKeyForSnapshot(k.key) }
      }

      // Multiple keys: the rotation pointer holds the id most recently handed
      // out for this provider. Match against ALL keys — the key may have been
      // disabled or relabeled between use and persist.
      const lastUsedKeyId = providerService.getLastUsedApiKeyId(providerId)
      if (lastUsedKeyId) {
        const k = allKeys.find((entry) => entry.id === lastUsedKeyId)
        if (k) {
          return {
            attribution: 'rotation',
            providerName,
            keyId: k.id,
            label: k.label,
            masked: maskApiKeyForSnapshot(k.key)
          }
        }
      }
      return { attribution: 'none', providerName }
    } catch {
      // Provider deleted between request and persist.
      return { attribution: 'none' }
    }
  }

  private async readPricingForBackfill(modelId: UniqueModelId): Promise<RuntimeModelPricing | undefined> {
    const [row] = await application
      .get('DbService')
      .getDb()
      .select({ pricing: userModelTable.pricing })
      .from(userModelTable)
      .where(eq(userModelTable.id, modelId))
      .limit(1)

    return row?.pricing ?? undefined
  }

  private async collectCostBackfill(query: UsageLedgerCostBackfillQuery): Promise<CostBackfillPlan> {
    const db = application.get('DbService').getDb()
    const baseConditions = buildCostBackfillBaseConditions(query)
    const [rows, [{ count: providerCostCount }], pricing] = await Promise.all([
      db
        .select({
          id: usageLedgerTable.id,
          inputTokens: usageLedgerTable.inputTokens,
          outputTokens: usageLedgerTable.outputTokens,
          totalTokens: usageLedgerTable.totalTokens,
          reasoningTokens: usageLedgerTable.reasoningTokens,
          noCacheTokens: usageLedgerTable.noCacheTokens,
          cacheReadTokens: usageLedgerTable.cacheReadTokens,
          cacheWriteTokens: usageLedgerTable.cacheWriteTokens
        })
        .from(usageLedgerTable)
        .where(and(...baseConditions, isNull(usageLedgerTable.cost))),
      db
        .select({ count: sql<number>`count(*)` })
        .from(usageLedgerTable)
        .where(and(...baseConditions, eq(usageLedgerTable.costSource, 'provider'))),
      this.readPricingForBackfill(query.modelId)
    ])

    if (!pricing) {
      return {
        scannedCount: rows.length,
        recalculableCount: 0,
        skippedNoPricingCount: rows.length,
        skippedProviderCostCount: providerCostCount,
        estimatedCostByCurrency: [],
        updates: []
      }
    }

    const capturedAt = new Date().toISOString()
    const totals = new Map<string, number>()
    const updates: CostBackfillUpdate[] = []
    let skippedNoPricingCount = 0

    for (const row of rows) {
      const computed = computeStatsCostSnapshot(buildStatsFromLedgerRow(row), pricing, capturedAt)
      if (!computed) {
        skippedNoPricingCount++
        continue
      }

      addEstimatedCost(totals, computed.costCurrency, computed.cost)
      updates.push({
        id: row.id,
        cost: computed.cost,
        costCurrency: computed.costCurrency,
        costBreakdown: computed.costBreakdown,
        pricingSnapshot: computed.pricingSnapshot
      })
    }

    return {
      scannedCount: rows.length,
      recalculableCount: updates.length,
      skippedNoPricingCount,
      skippedProviderCostCount: providerCostCount,
      estimatedCostByCurrency: [...totals.entries()].map(([currency, cost]) => ({ currency, cost })),
      updates
    }
  }

  async previewCostBackfill(query: UsageLedgerCostBackfillQuery): Promise<UsageLedgerCostBackfillPreviewResponse> {
    const plan = await this.collectCostBackfill(query)
    return {
      scannedCount: plan.scannedCount,
      recalculableCount: plan.recalculableCount,
      skippedNoPricingCount: plan.skippedNoPricingCount,
      skippedProviderCostCount: plan.skippedProviderCostCount,
      estimatedCostByCurrency: plan.estimatedCostByCurrency
    }
  }

  async runCostBackfill(query: UsageLedgerCostBackfillQuery): Promise<UsageLedgerCostBackfillRunResponse> {
    const { updates, ...preview } = await this.collectCostBackfill(query)
    if (updates.length === 0) {
      return { ...preview, updatedCount: 0 }
    }

    let updatedCount = 0
    const CHUNK_SIZE = 100
    await application.get('DbService').withWriteTx(async (tx) => {
      for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
        for (const update of updates.slice(i, i + CHUNK_SIZE)) {
          const updatedRows = await tx
            .update(usageLedgerTable)
            .set({
              cost: update.cost,
              costCurrency: update.costCurrency,
              costSource: 'computed',
              costBreakdown: update.costBreakdown,
              pricingSnapshot: update.pricingSnapshot,
              updatedAt: Date.now()
            })
            .where(and(eq(usageLedgerTable.id, update.id), isNull(usageLedgerTable.cost)))
            .returning({ id: usageLedgerTable.id })

          updatedCount += updatedRows.length
        }
      }
    })

    return { ...preview, updatedCount }
  }

  async list(query: UsageLedgerListServiceQuery): Promise<UsageLedgerListResponse> {
    const db = application.get('DbService').getDb()
    const { limit, page } = query
    const offset = (page - 1) * limit

    const filterConditions: SQL[] = []
    if (query.providerId !== undefined) filterConditions.push(eq(usageLedgerTable.providerId, query.providerId))
    if (query.apiKeyId !== undefined) filterConditions.push(eq(usageLedgerTable.apiKeyId, query.apiKeyId))
    if (query.from !== undefined) filterConditions.push(gte(usageLedgerTable.createdAt, query.from))
    if (query.to !== undefined) filterConditions.push(lte(usageLedgerTable.createdAt, query.to))
    const where = filterConditions.length > 0 ? and(...filterConditions) : undefined
    const tokensPerSecond = sql<number>`CASE
      WHEN ${usageLedgerTable.outputTokens} IS NULL
        OR ${usageLedgerTable.outputTokens} <= 0
        OR ${usageLedgerTable.timeCompletionMs} IS NULL
        OR ${usageLedgerTable.timeCompletionMs} <= 0
      THEN NULL
      ELSE ${usageLedgerTable.outputTokens} / (
        (CASE
          WHEN ${usageLedgerTable.timeFirstTokenMs} IS NOT NULL
            AND ${usageLedgerTable.timeFirstTokenMs} < ${usageLedgerTable.timeCompletionMs}
          THEN ${usageLedgerTable.timeCompletionMs} - ${usageLedgerTable.timeFirstTokenMs}
          ELSE ${usageLedgerTable.timeCompletionMs}
        END) / 1000.0
      )
    END`
    const sortExpression =
      query.sortBy === 'totalTokens'
        ? usageLedgerTable.totalTokens
        : query.sortBy === 'cost'
          ? usageLedgerTable.cost
          : query.sortBy === 'timeFirstTokenMs'
            ? usageLedgerTable.timeFirstTokenMs
            : query.sortBy === 'tokensPerSecond'
              ? tokensPerSecond
              : usageLedgerTable.createdAt
    const sortOrder = query.sortDirection === 'asc' ? asc(sortExpression) : desc(sortExpression)

    const [rows, [{ count }]] = await Promise.all([
      db
        .select()
        .from(usageLedgerTable)
        .where(where)
        .orderBy(sql`${sortExpression} IS NULL`, sortOrder, desc(usageLedgerTable.createdAt), asc(usageLedgerTable.id))
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(usageLedgerTable).where(where)
    ])

    const providerNames = await readProviderNameMap()

    return {
      items: rows.map((row) =>
        rowToEntry({
          ...row,
          providerName: resolveProviderNameSnapshot(row.providerId, row.providerName, providerNames)
        })
      ),
      total: count,
      page
    }
  }

  async stats(query: UsageLedgerStatsQuery): Promise<UsageLedgerStatsResponse> {
    const db = application.get('DbService').getDb()

    const conditions: SQL[] = []
    if (query.providerId !== undefined) conditions.push(eq(usageLedgerTable.providerId, query.providerId))
    if (query.from !== undefined) conditions.push(gte(usageLedgerTable.createdAt, query.from))
    if (query.to !== undefined) conditions.push(lte(usageLedgerTable.createdAt, query.to))
    const where = conditions.length > 0 ? and(...conditions) : undefined

    // costCurrency always participates in the group key — USD and CNY must
    // never be summed into one number.
    const groupColumns =
      query.groupBy === 'apiKey'
        ? [usageLedgerTable.providerId, usageLedgerTable.apiKeyId, usageLedgerTable.costCurrency]
        : query.groupBy === 'model'
          ? [usageLedgerTable.providerId, usageLedgerTable.modelId, usageLedgerTable.costCurrency]
          : query.groupBy === 'source'
            ? [usageLedgerTable.sourceType, usageLedgerTable.sourceId, usageLedgerTable.costCurrency]
            : [usageLedgerTable.providerId, usageLedgerTable.costCurrency]

    const rows = await db
      .select({
        providerId: usageLedgerTable.providerId,
        providerName: sql<string | null>`max(${usageLedgerTable.providerName})`,
        sourceType: usageLedgerTable.sourceType,
        sourceId: usageLedgerTable.sourceId,
        sourceName: sql<string | null>`max(${usageLedgerTable.sourceName})`,
        sourceIcon: sql<string | null>`max(${usageLedgerTable.sourceIcon})`,
        apiKeyId: usageLedgerTable.apiKeyId,
        modelId: usageLedgerTable.modelId,
        costCurrency: usageLedgerTable.costCurrency,
        // Representative display fields (rows in one key bucket share them in
        // practice; max() just picks a stable value if labels changed).
        apiKeyLabel: sql<string | null>`max(${usageLedgerTable.apiKeyLabel})`,
        apiKeyMasked: sql<string | null>`max(${usageLedgerTable.apiKeyMasked})`,
        apiKeyAttribution: sql<string>`max(${usageLedgerTable.apiKeyAttribution})`,
        totalCost: sql<number>`coalesce(sum(${usageLedgerTable.cost}), 0)`,
        totalInputTokens: sql<number>`coalesce(sum(${usageLedgerTable.inputTokens}), 0)`,
        totalOutputTokens: sql<number>`coalesce(sum(${usageLedgerTable.outputTokens}), 0)`,
        totalTokens: sql<number>`coalesce(sum(${usageLedgerTable.totalTokens}), 0)`,
        totalNoCacheTokens: sql<number>`coalesce(sum(${usageLedgerTable.noCacheTokens}), 0)`,
        totalCacheReadTokens: sql<number>`coalesce(sum(${usageLedgerTable.cacheReadTokens}), 0)`,
        totalCacheWriteTokens: sql<number>`coalesce(sum(${usageLedgerTable.cacheWriteTokens}), 0)`,
        entryCount: sql<number>`count(*)`
      })
      .from(usageLedgerTable)
      .where(where)
      .groupBy(...groupColumns)
      .orderBy(sql`coalesce(sum(${usageLedgerTable.cost}), 0) desc`)

    const providerNames = await readProviderNameMap()
    const buckets: UsageLedgerStatsBucket[] = rows.map((row) => ({
      providerId: row.providerId,
      providerName: resolveProviderNameSnapshot(row.providerId, row.providerName, providerNames),
      costCurrency: row.costCurrency,
      totalCost: row.totalCost,
      totalInputTokens: row.totalInputTokens,
      totalOutputTokens: row.totalOutputTokens,
      totalTokens: row.totalTokens,
      totalNoCacheTokens: row.totalNoCacheTokens,
      totalCacheReadTokens: row.totalCacheReadTokens,
      totalCacheWriteTokens: row.totalCacheWriteTokens,
      entryCount: row.entryCount,
      ...(query.groupBy === 'source'
        ? {
            sourceType: row.sourceType as UsageLedgerSourceType | null,
            sourceId: row.sourceId,
            sourceName: row.sourceName,
            sourceIcon: row.sourceIcon
          }
        : {}),
      ...(query.groupBy === 'apiKey'
        ? {
            apiKeyId: row.apiKeyId,
            apiKeyLabel: row.apiKeyLabel,
            apiKeyMasked: row.apiKeyMasked,
            apiKeyAttribution: row.apiKeyAttribution as UsageLedgerAttribution
          }
        : {}),
      ...(query.groupBy === 'model' ? { modelId: row.modelId } : {})
    }))

    return { buckets }
  }

  async timeline(query: UsageLedgerTimelineQuery): Promise<UsageLedgerTimelineResponse> {
    const db = application.get('DbService').getDb()

    const conditions: SQL[] = []
    if (query.from !== undefined) conditions.push(gte(usageLedgerTable.createdAt, query.from))
    if (query.to !== undefined) conditions.push(lte(usageLedgerTable.createdAt, query.to))
    const where = conditions.length > 0 ? and(...conditions) : undefined

    const dayBucket = sql<string>`date(${usageLedgerTable.createdAt} / 1000, 'unixepoch', 'localtime')`

    const rows = await db
      .select({
        date: dayBucket,
        totalTokens: sql<number>`coalesce(sum(${usageLedgerTable.totalTokens}), 0)`,
        totalNoCacheTokens: sql<number>`coalesce(sum(${usageLedgerTable.noCacheTokens}), 0)`,
        totalCacheReadTokens: sql<number>`coalesce(sum(${usageLedgerTable.cacheReadTokens}), 0)`,
        totalCacheWriteTokens: sql<number>`coalesce(sum(${usageLedgerTable.cacheWriteTokens}), 0)`,
        // Naive cross-currency sum for timeline shape only. The renderer
        // defaults to token intensity and enables cost mode only for an
        // effectively single-currency ledger window.
        totalCost: sql<number>`coalesce(sum(${usageLedgerTable.cost}), 0)`,
        entryCount: sql<number>`count(*)`
      })
      .from(usageLedgerTable)
      .where(where)
      .groupBy(dayBucket)
      .orderBy(asc(dayBucket))

    return { buckets: rows }
  }
}

export const usageLedgerService = new UsageLedgerService()
