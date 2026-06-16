import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { assistantTable } from '@data/db/schemas/assistant'
import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { type InsertUsageLedgerRow, usageLedgerTable } from '@data/db/schemas/usageLedger'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import type { DbType } from '@data/db/types'
import { computeStatsCostSnapshot } from '@data/services/utils/costEnrichment'
import type { ExecuteResult, PrepareResult, ValidateResult } from '@shared/data/migration/v2/types'
import type { MessageStats, ModelSnapshot } from '@shared/data/types/message'
import { parseUniqueModelId, type RuntimeModelPricing, type UniqueModelId } from '@shared/data/types/model'
import type { ApiKeyEntry } from '@shared/data/types/provider'
import type { UsageLedgerSourceType } from '@shared/data/types/usageLedger'
import { maskApiKeyForSnapshot } from '@shared/utils/api'
import { and, eq, isNotNull, or, sql } from 'drizzle-orm'

import type { MigrationContext } from '../core/MigrationContext'
import { BaseMigrator } from './BaseMigrator'
import { legacyModelToUniqueId } from './transformers/ModelTransformers'

type UsageLedgerSourceRow = {
  id: string
  topicId: string | null
  sourceType: UsageLedgerSourceType | null
  sourceId: string | null
  sourceName: string | null
  sourceIcon: unknown
  modelId: string | null
  modelSnapshot: ModelSnapshot | null
  stats: MessageStats | null
  createdAt: number
}

type ProviderSnapshot = {
  name: string
  apiKey?: {
    id: string
    label: string | null
    masked: string
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

function hasUsageSignal(stats: MessageStats): boolean {
  return (
    stats.inputTokens !== undefined ||
    stats.outputTokens !== undefined ||
    stats.totalTokens !== undefined ||
    stats.cost !== undefined
  )
}

function statsToColumns(stats: MessageStats) {
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

function resolveLedgerModel(source: UsageLedgerSourceRow): { providerId: string; modelId: UniqueModelId } | null {
  const candidate = (source.modelId ?? legacyModelToUniqueId(source.modelSnapshot)) as UniqueModelId | null
  if (!candidate) {
    return null
  }

  try {
    const { providerId } = parseUniqueModelId(candidate)
    return { providerId, modelId: candidate }
  } catch {
    return null
  }
}

function getAgentAvatar(configuration: unknown): string | undefined {
  if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) return undefined
  const avatar = (configuration as { avatar?: unknown }).avatar
  return typeof avatar === 'string' ? avatar : undefined
}

function resolveSourceIcon(source: UsageLedgerSourceRow): string | null {
  if (source.sourceType === 'agent') {
    return getAgentAvatar(source.sourceIcon) ?? null
  }

  return typeof source.sourceIcon === 'string' ? source.sourceIcon : null
}

async function countCandidateRows(db: DbType): Promise<number> {
  const [chat, agentSession] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)` })
      .from(messageTable)
      .where(
        and(
          eq(messageTable.role, 'assistant'),
          isNotNull(messageTable.stats),
          or(isNotNull(messageTable.modelId), isNotNull(messageTable.modelSnapshot))
        )
      )
      .get(),
    db
      .select({ count: sql<number>`count(*)` })
      .from(agentSessionMessageTable)
      .where(
        and(
          eq(agentSessionMessageTable.role, 'assistant'),
          isNotNull(agentSessionMessageTable.stats),
          or(isNotNull(agentSessionMessageTable.modelId), isNotNull(agentSessionMessageTable.modelSnapshot))
        )
      )
      .get()
  ])

  return (chat?.count ?? 0) + (agentSession?.count ?? 0)
}

async function readCandidateRows(db: DbType): Promise<UsageLedgerSourceRow[]> {
  const [chatRows, agentSessionRows] = await Promise.all([
    db
      .select({
        id: messageTable.id,
        topicId: messageTable.topicId,
        sourceType: sql<UsageLedgerSourceType | null>`CASE WHEN ${topicTable.assistantId} IS NOT NULL THEN 'assistant' ELSE NULL END`,
        sourceId: topicTable.assistantId,
        sourceName: assistantTable.name,
        sourceIcon: assistantTable.emoji,
        modelId: messageTable.modelId,
        modelSnapshot: messageTable.modelSnapshot,
        stats: messageTable.stats,
        createdAt: messageTable.createdAt
      })
      .from(messageTable)
      .leftJoin(topicTable, eq(messageTable.topicId, topicTable.id))
      .leftJoin(assistantTable, eq(topicTable.assistantId, assistantTable.id))
      .where(
        and(
          eq(messageTable.role, 'assistant'),
          isNotNull(messageTable.stats),
          or(isNotNull(messageTable.modelId), isNotNull(messageTable.modelSnapshot))
        )
      ),
    db
      .select({
        id: agentSessionMessageTable.id,
        topicId: sql<string | null>`NULL`,
        sourceType: sql<UsageLedgerSourceType | null>`CASE WHEN ${agentSessionTable.agentId} IS NOT NULL THEN 'agent' ELSE NULL END`,
        sourceId: agentSessionTable.agentId,
        sourceName: agentTable.name,
        sourceIcon: agentTable.configuration,
        modelId: agentSessionMessageTable.modelId,
        modelSnapshot: agentSessionMessageTable.modelSnapshot,
        stats: agentSessionMessageTable.stats,
        createdAt: agentSessionMessageTable.createdAt
      })
      .from(agentSessionMessageTable)
      .leftJoin(agentSessionTable, eq(agentSessionMessageTable.sessionId, agentSessionTable.id))
      .leftJoin(agentTable, eq(agentSessionTable.agentId, agentTable.id))
      .where(
        and(
          eq(agentSessionMessageTable.role, 'assistant'),
          isNotNull(agentSessionMessageTable.stats),
          or(isNotNull(agentSessionMessageTable.modelId), isNotNull(agentSessionMessageTable.modelSnapshot))
        )
      )
  ])

  return [...chatRows, ...agentSessionRows]
}

function toApiKeySnapshot(apiKeys: ApiKeyEntry[] | null): ProviderSnapshot['apiKey'] {
  const apiKey = apiKeys?.[0]
  if (!apiKey) {
    return undefined
  }

  return {
    id: apiKey.id,
    label: apiKey.label ?? null,
    masked: maskApiKeyForSnapshot(apiKey.key)
  }
}

async function readProviderSnapshots(db: DbType): Promise<Map<string, ProviderSnapshot>> {
  const rows = await db
    .select({
      providerId: userProviderTable.providerId,
      name: userProviderTable.name,
      apiKeys: userProviderTable.apiKeys
    })
    .from(userProviderTable)
  return new Map(
    rows.map((row) => [
      row.providerId,
      {
        name: row.name,
        apiKey: toApiKeySnapshot(row.apiKeys)
      }
    ])
  )
}

async function readModelPricingSnapshots(db: DbType): Promise<Map<UniqueModelId, RuntimeModelPricing>> {
  const rows = await db.select({ id: userModelTable.id, pricing: userModelTable.pricing }).from(userModelTable)
  return new Map(
    rows
      .filter((row): row is { id: UniqueModelId; pricing: RuntimeModelPricing } => row.pricing !== null)
      .map((row) => [row.id, row.pricing])
  )
}

function enrichMissingCostForMigration(
  stats: MessageStats,
  modelId: UniqueModelId,
  pricingSnapshots: Map<UniqueModelId, RuntimeModelPricing>,
  capturedAt: string
): MessageStats {
  if (stats.cost !== undefined) {
    return stats
  }

  const pricing = pricingSnapshots.get(modelId)
  if (!pricing) {
    return stats
  }

  const computed = computeStatsCostSnapshot(stats, pricing, capturedAt)
  return computed ? { ...stats, ...computed } : stats
}

function toLedgerRow(
  source: UsageLedgerSourceRow,
  providerSnapshots: Map<string, ProviderSnapshot>,
  pricingSnapshots: Map<UniqueModelId, RuntimeModelPricing>,
  capturedAt: string
): InsertUsageLedgerRow | null {
  if (!source.stats || !hasUsageSignal(source.stats)) {
    return null
  }

  const model = resolveLedgerModel(source)
  if (!model) {
    return null
  }

  const providerSnapshot = providerSnapshots.get(model.providerId)
  const stats = enrichMissingCostForMigration(source.stats, model.modelId, pricingSnapshots, capturedAt)
  const apiKey = providerSnapshot?.apiKey
  const apiKeyColumns = apiKey
    ? {
        apiKeyId: apiKey.id,
        apiKeyLabel: apiKey.label,
        apiKeyMasked: apiKey.masked,
        apiKeyAttribution: 'backfill' as const
      }
    : {
        apiKeyAttribution: 'none' as const
      }

  return {
    messageId: source.id,
    topicId: source.topicId,
    providerId: model.providerId,
    providerName:
      providerSnapshot?.name ??
      (source.modelSnapshot?.provider &&
      (source.modelSnapshot.provider !== model.providerId || !isUuid(model.providerId))
        ? source.modelSnapshot.provider
        : null),
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    sourceName: source.sourceName,
    sourceIcon: resolveSourceIcon(source),
    modelId: model.modelId,
    modality: 'language',
    ...apiKeyColumns,
    ...statsToColumns(stats),
    createdAt: source.createdAt,
    updatedAt: source.createdAt
  }
}

export class UsageLedgerMigrator extends BaseMigrator {
  readonly id = 'usage-ledger'
  readonly name = 'Usage Ledger'
  readonly description = 'Backfill usage ledger rows from migrated chat and agent session messages'
  readonly order = 4.1

  private sourceCount = 0
  private skippedCount = 0
  private insertedCount = 0

  reset(): void {
    this.sourceCount = 0
    this.skippedCount = 0
    this.insertedCount = 0
  }

  async prepare(ctx: MigrationContext): Promise<PrepareResult> {
    this.sourceCount = await countCandidateRows(ctx.db)
    return { success: true, itemCount: this.sourceCount }
  }

  async execute(ctx: MigrationContext): Promise<ExecuteResult> {
    const candidates = await readCandidateRows(ctx.db)
    const [providerSnapshots, pricingSnapshots] = await Promise.all([
      readProviderSnapshots(ctx.db),
      readModelPricingSnapshots(ctx.db)
    ])
    const capturedAt = new Date().toISOString()
    this.sourceCount = candidates.length

    const rows: InsertUsageLedgerRow[] = []
    for (const candidate of candidates) {
      const row = toLedgerRow(candidate, providerSnapshots, pricingSnapshots, capturedAt)
      if (row) {
        rows.push(row)
      } else {
        this.skippedCount++
      }
    }

    if (rows.length === 0) {
      this.insertedCount = 0
      return { success: true, processedCount: 0 }
    }

    const CHUNK_SIZE = 100
    await ctx.db.transaction(async (tx) => {
      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        await tx
          .insert(usageLedgerTable)
          .values(rows.slice(i, i + CHUNK_SIZE))
          .onConflictDoNothing({ target: usageLedgerTable.messageId })
      }
    })

    this.insertedCount = rows.length
    return { success: true, processedCount: rows.length }
  }

  async validate(ctx: MigrationContext): Promise<ValidateResult> {
    const [{ count: targetCount }] = await ctx.db.select({ count: sql<number>`count(*)` }).from(usageLedgerTable)
    const expectedCount = this.sourceCount - this.skippedCount

    return {
      success: targetCount >= expectedCount,
      errors:
        targetCount >= expectedCount
          ? []
          : [
              {
                key: 'usage-ledger.count',
                expected: expectedCount,
                actual: targetCount,
                message: 'Usage ledger row count is lower than migratable usage-bearing messages'
              }
            ],
      stats: {
        sourceCount: this.sourceCount,
        targetCount,
        skippedCount: this.skippedCount
      },
      diagnostics: {
        insertedCount: this.insertedCount
      }
    }
  }
}
