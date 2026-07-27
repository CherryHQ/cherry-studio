import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { aiUsageRecordTable, type InsertAiUsageRecordRow } from '@data/db/schemas/aiUsageRecord'
import { assistantTable } from '@data/db/schemas/assistant'
import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import type { DbType } from '@data/db/types'
import { computeStatsCostSnapshot } from '@data/services/utils/costEnrichment'
import { loggerService } from '@logger'
import type { ExecuteResult, PrepareResult, ValidateResult } from '@shared/data/migration/v2/types'
import type { AiUsageRecordSourceType } from '@shared/data/types/aiUsageRecord'
import type { MessageStats, ModelSnapshot } from '@shared/data/types/message'
import { parseUniqueModelId, type RuntimeModelPricing, type UniqueModelId } from '@shared/data/types/model'
import { and, asc, eq, gt, isNotNull, or, sql } from 'drizzle-orm'
import * as z from 'zod'

import type { MigrationContext } from '../core/MigrationContext'
import { BaseMigrator } from './BaseMigrator'
import { legacyModelToUniqueId } from './transformers/ModelTransformers'

const logger = loggerService.withContext('AiUsageRecordMigrator')

type AiUsageRecordSourceRow = {
  id: string
  topicId: string | null
  sourceType: AiUsageRecordSourceType | null
  sourceId: string | null
  sourceName: string | null
  sourceIcon: string | null
  modelId: string | null
  modelSnapshot: ModelSnapshot | null
  stats: MessageStats | null
  createdAt: number
}

type ProviderSnapshot = {
  name: string
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

function resolveRecordModel(source: AiUsageRecordSourceRow): { providerId: string; modelId: UniqueModelId } | null {
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

const AgentConfigurationSchema = z.object({ avatar: z.string().optional().catch(undefined) })

function getAgentAvatar(configuration: unknown): string | undefined {
  return AgentConfigurationSchema.safeParse(configuration).data?.avatar
}

function countCandidateRows(db: DbType): number {
  const chat = db
    .select({ count: sql<number>`count(*)` })
    .from(messageTable)
    .where(
      and(
        eq(messageTable.role, 'assistant'),
        isNotNull(messageTable.stats),
        or(isNotNull(messageTable.modelId), isNotNull(messageTable.messageSnapshot))
      )
    )
    .get()
  const agentSession = db
    .select({ count: sql<number>`count(*)` })
    .from(agentSessionMessageTable)
    .where(
      and(
        eq(agentSessionMessageTable.role, 'assistant'),
        isNotNull(agentSessionMessageTable.stats),
        or(isNotNull(agentSessionMessageTable.modelId), isNotNull(agentSessionMessageTable.messageSnapshot))
      )
    )
    .get()

  return (chat?.count ?? 0) + (agentSession?.count ?? 0)
}

function readChatCandidateRows(db: DbType, afterId: string | undefined, limit: number): AiUsageRecordSourceRow[] {
  const rows = db
    .select({
      id: messageTable.id,
      topicId: messageTable.topicId,
      sourceType: sql<AiUsageRecordSourceType | null>`CASE WHEN ${topicTable.assistantId} IS NOT NULL THEN 'assistant' ELSE NULL END`,
      sourceId: topicTable.assistantId,
      sourceName: assistantTable.name,
      sourceIcon: assistantTable.emoji,
      modelId: messageTable.modelId,
      messageSnapshot: messageTable.messageSnapshot,
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
        or(isNotNull(messageTable.modelId), isNotNull(messageTable.messageSnapshot)),
        afterId ? gt(messageTable.id, afterId) : undefined
      )
    )
    .orderBy(asc(messageTable.id))
    .limit(limit)
    .all()

  return rows.map(({ messageSnapshot, ...rest }) => ({
    ...rest,
    sourceType: messageSnapshot ? 'assistant' : rest.sourceType,
    sourceId: messageSnapshot?.id ?? rest.sourceId,
    sourceName: messageSnapshot?.name ?? rest.sourceName,
    sourceIcon: messageSnapshot?.emoji ?? rest.sourceIcon,
    modelSnapshot: messageSnapshot?.model ?? null
  }))
}

function readAgentSessionCandidateRows(
  db: DbType,
  afterId: string | undefined,
  limit: number
): AiUsageRecordSourceRow[] {
  const rows = db
    .select({
      id: agentSessionMessageTable.id,
      topicId: sql<string | null>`NULL`,
      sourceType: sql<AiUsageRecordSourceType | null>`CASE WHEN ${agentSessionTable.agentId} IS NOT NULL THEN 'agent' ELSE NULL END`,
      sourceId: agentSessionTable.agentId,
      sourceName: agentTable.name,
      agentConfiguration: agentTable.configuration,
      modelId: agentSessionMessageTable.modelId,
      messageSnapshot: agentSessionMessageTable.messageSnapshot,
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
        or(isNotNull(agentSessionMessageTable.modelId), isNotNull(agentSessionMessageTable.messageSnapshot)),
        afterId ? gt(agentSessionMessageTable.id, afterId) : undefined
      )
    )
    .orderBy(asc(agentSessionMessageTable.id))
    .limit(limit)
    .all()

  return rows.map(({ messageSnapshot, agentConfiguration, ...rest }) => ({
    ...rest,
    sourceType: messageSnapshot ? 'agent' : rest.sourceType,
    sourceId: messageSnapshot?.id ?? rest.sourceId,
    sourceName: messageSnapshot?.name ?? rest.sourceName,
    sourceIcon: messageSnapshot?.emoji ?? getAgentAvatar(agentConfiguration) ?? null,
    modelSnapshot: messageSnapshot?.model ?? null
  }))
}

function readProviderSnapshots(db: DbType): Map<string, ProviderSnapshot> {
  const rows = db
    .select({ providerId: userProviderTable.providerId, name: userProviderTable.name })
    .from(userProviderTable)
    .all()
  return new Map(rows.map((row) => [row.providerId, { name: row.name }]))
}

function readModelPricingSnapshots(db: DbType): Map<UniqueModelId, RuntimeModelPricing> {
  const rows = db.select({ id: userModelTable.id, pricing: userModelTable.pricing }).from(userModelTable).all()
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
    // Legacy MessageStats only stored OpenRouter's provider-reported USD cost.
    // Normalize that historical contract into the usage record's required tuple
    // while preserving any newer explicit metadata already present.
    return {
      ...stats,
      costCurrency: stats.costCurrency ?? 'USD',
      costSource: stats.costSource ?? 'provider'
    }
  }

  const pricing = pricingSnapshots.get(modelId)
  if (!pricing) {
    // A legacy partial annotation without an amount is not a cost tuple.
    // Preserve usage metrics, but keep every cost column absent together.
    return {
      ...stats,
      costCurrency: undefined,
      costSource: undefined,
      costBreakdown: undefined,
      pricingSnapshot: undefined
    }
  }

  const computed = computeStatsCostSnapshot(stats, pricing, capturedAt)
  return computed ? { ...stats, ...computed } : stats
}

function toRecordRow(
  source: AiUsageRecordSourceRow,
  providerSnapshots: Map<string, ProviderSnapshot>,
  pricingSnapshots: Map<UniqueModelId, RuntimeModelPricing>,
  capturedAt: string
): InsertAiUsageRecordRow | null {
  if (!source.stats || !hasUsageSignal(source.stats)) {
    return null
  }

  const model = resolveRecordModel(source)
  if (!model) {
    return null
  }

  const providerSnapshot = providerSnapshots.get(model.providerId)
  const stats = enrichMissingCostForMigration(source.stats, model.modelId, pricingSnapshots, capturedAt)

  return {
    requestId: source.id,
    captureSource: 'migration',
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
    sourceIcon: source.sourceIcon,
    modelId: model.modelId,
    modality: 'language',
    apiKeyAttribution: 'unknown',
    ...statsToColumns(stats),
    createdAt: source.createdAt,
    updatedAt: source.createdAt
  }
}

export class AiUsageRecordMigrator extends BaseMigrator {
  readonly id = 'ai-usage-record'
  readonly name = 'AI Usage Records'
  readonly description = 'Project migrated chat and agent message usage into AI usage records'
  readonly order = 4.1

  private preparedCount = 0
  private sourceCount = 0
  private skippedCount = 0
  private insertedCount = 0

  reset(): void {
    this.preparedCount = 0
    this.sourceCount = 0
    this.skippedCount = 0
    this.insertedCount = 0
  }

  async prepare(ctx: MigrationContext): Promise<PrepareResult> {
    this.preparedCount = countCandidateRows(ctx.db)
    return { success: true, itemCount: this.preparedCount }
  }

  async execute(ctx: MigrationContext): Promise<ExecuteResult> {
    const providerSnapshots = readProviderSnapshots(ctx.db)
    const pricingSnapshots = readModelPricingSnapshots(ctx.db)
    const capturedAt = new Date().toISOString()
    if (this.preparedCount === 0) {
      this.preparedCount = countCandidateRows(ctx.db)
    }
    this.sourceCount = 0
    this.skippedCount = 0
    this.insertedCount = 0
    const warnings: string[] = []

    const CANDIDATE_BATCH_SIZE = 500
    const INSERT_CHUNK_SIZE = 100
    const readers = [readChatCandidateRows, readAgentSessionCandidateRows]

    for (const readBatch of readers) {
      let afterId: string | undefined
      while (true) {
        const candidates = readBatch(ctx.db, afterId, CANDIDATE_BATCH_SIZE)
        if (candidates.length === 0) break

        this.sourceCount += candidates.length
        const rows: InsertAiUsageRecordRow[] = []
        for (const candidate of candidates) {
          const row = toRecordRow(candidate, providerSnapshots, pricingSnapshots, capturedAt)
          if (row) {
            rows.push(row)
          } else {
            this.skippedCount++
          }
        }

        if (rows.length > 0) {
          try {
            let inserted = 0
            ctx.db.transaction((tx) => {
              for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
                const result = tx
                  .insert(aiUsageRecordTable)
                  .values(rows.slice(i, i + INSERT_CHUNK_SIZE))
                  .onConflictDoNothing({ target: aiUsageRecordTable.requestId })
                  .run()
                // Count what SQLite actually wrote: a conflict-skipped re-run
                // inserts nothing, and reporting it as inserted would hide that.
                inserted += result.changes
              }
            })
            this.insertedCount += inserted
          } catch (error) {
            // Usage records are derived, reconstructible data and every runtime write
            // path treats it as best-effort. A malformed row must not abort the
            // whole v1 -> v2 migration and strand the user in the error stage.
            // The transaction rolled back every chunk, so retry each row outside
            // it and skip only the rows that still cannot be inserted.
            logger.warn('Failed to insert AI usage record batch, retrying row by row', {
              batchSize: rows.length,
              error
            })
            let skipped = 0
            for (const row of rows) {
              try {
                const result = ctx.db
                  .insert(aiUsageRecordTable)
                  .values(row)
                  .onConflictDoNothing({ target: aiUsageRecordTable.requestId })
                  .run()
                this.insertedCount += result.changes
              } catch (rowError) {
                skipped++
                logger.warn('Failed to insert AI usage record, skipping it', {
                  requestId: row.requestId,
                  error: rowError
                })
              }
            }
            this.skippedCount += skipped
            if (skipped > 0) {
              warnings.push(`Skipped ${skipped} AI usage record(s) after individual insert retries`)
            }
          }
        }

        afterId = candidates.at(-1)?.id
        const progress = this.preparedCount === 0 ? 100 : Math.min(100, (this.sourceCount / this.preparedCount) * 100)
        this.reportProgress(progress, `Processed ${this.sourceCount}/${this.preparedCount} AI usage candidates`)
        if (candidates.length < CANDIDATE_BATCH_SIZE) break
      }
    }

    this.assertOwnedForeignKeys(ctx.db, [aiUsageRecordTable])
    if (this.sourceCount === 0) {
      this.reportProgress(100, 'No AI usage candidates to migrate')
    }

    return { success: true, processedCount: this.insertedCount, ...(warnings.length > 0 ? { warnings } : {}) }
  }

  async validate(ctx: MigrationContext): Promise<ValidateResult> {
    const [{ count: targetCount }] = await ctx.db.select({ count: sql<number>`count(*)` }).from(aiUsageRecordTable)
    const expectedCount = this.sourceCount - this.skippedCount

    return {
      success: targetCount >= expectedCount,
      errors:
        targetCount >= expectedCount
          ? []
          : [
              {
                key: 'ai-usage-record.count',
                expected: expectedCount,
                actual: targetCount,
                message: 'AI usage record count is lower than migratable usage-bearing messages'
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
