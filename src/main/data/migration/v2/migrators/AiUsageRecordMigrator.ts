import { and, asc, eq, gt, isNotNull, sql } from 'drizzle-orm'

import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { aiUsageRecordTable } from '@data/db/schemas/aiUsageRecord'
import { messageTable } from '@data/db/schemas/message'
import type { DbType } from '@data/db/types'
import { aiUsageRecordService, type LegacyAggregateInput } from '@data/services/AiUsageRecordService'
import { loggerService } from '@logger'
import type { ExecuteResult, PrepareResult, ValidateResult } from '@shared/data/migration/v2/types'
import type { AiUsageRecordMessageKind } from '@shared/data/types/aiUsageRecord'
import type { MessageSnapshot, MessageStats } from '@shared/data/types/message'
import { type Currency, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'

import type { MigrationContext } from '../core/MigrationContext'
import { BaseMigrator } from './BaseMigrator'

const logger = loggerService.withContext('AiUsageRecordMigrator')

type AiUsageRecordSourceRow = {
  id: string
  messageKind: AiUsageRecordMessageKind
  modelId: string | null
  messageSnapshot: MessageSnapshot | null
  stats: MessageStats | null
  createdAt: number
}

function hasUsageSignal(stats: MessageStats): boolean {
  return (
    stats.inputTokens !== undefined ||
    stats.outputTokens !== undefined ||
    stats.totalTokens !== undefined ||
    stats.inputTokenDetails?.noCacheTokens !== undefined ||
    stats.inputTokenDetails?.cacheReadTokens !== undefined ||
    stats.inputTokenDetails?.cacheWriteTokens !== undefined ||
    stats.outputTokenDetails?.reasoningTokens !== undefined ||
    (stats.costs?.length ?? 0) > 0
  )
}

function countCandidateRows(db: DbType): number {
  const chat =
    db
      .select({ count: sql<number>`count(*)` })
      .from(messageTable)
      .where(and(eq(messageTable.role, 'assistant'), isNotNull(messageTable.stats)))
      .get()?.count ?? 0
  const agentSession =
    db
      .select({ count: sql<number>`count(*)` })
      .from(agentSessionMessageTable)
      .where(and(eq(agentSessionMessageTable.role, 'assistant'), isNotNull(agentSessionMessageTable.stats)))
      .get()?.count ?? 0
  return chat + agentSession
}

function readChatCandidateRows(db: DbType, afterId: string | undefined, limit: number): AiUsageRecordSourceRow[] {
  return db
    .select({
      id: messageTable.id,
      modelId: messageTable.modelId,
      messageSnapshot: messageTable.messageSnapshot,
      stats: messageTable.stats,
      createdAt: messageTable.createdAt
    })
    .from(messageTable)
    .where(
      and(
        eq(messageTable.role, 'assistant'),
        isNotNull(messageTable.stats),
        afterId ? gt(messageTable.id, afterId) : undefined
      )
    )
    .orderBy(asc(messageTable.id))
    .limit(limit)
    .all()
    .map((row) => ({ ...row, messageKind: 'chat' as const }))
}

function readAgentSessionCandidateRows(
  db: DbType,
  afterId: string | undefined,
  limit: number
): AiUsageRecordSourceRow[] {
  return db
    .select({
      id: agentSessionMessageTable.id,
      modelId: agentSessionMessageTable.modelId,
      messageSnapshot: agentSessionMessageTable.messageSnapshot,
      stats: agentSessionMessageTable.stats,
      createdAt: agentSessionMessageTable.createdAt
    })
    .from(agentSessionMessageTable)
    .where(
      and(
        eq(agentSessionMessageTable.role, 'assistant'),
        isNotNull(agentSessionMessageTable.stats),
        afterId ? gt(agentSessionMessageTable.id, afterId) : undefined
      )
    )
    .orderBy(asc(agentSessionMessageTable.id))
    .limit(limit)
    .all()
    .map((row) => ({ ...row, messageKind: 'agent-session' as const }))
}

function resolveLegacyModel(source: AiUsageRecordSourceRow): {
  providerId: string | null
  modelId: string | null
  modelName: string | null
} {
  const snapshot = source.messageSnapshot?.model
  if (snapshot) {
    return {
      providerId: snapshot.provider || null,
      modelId: snapshot.id || null,
      modelName: snapshot.name || snapshot.id || null
    }
  }
  if (!source.modelId) return { providerId: null, modelId: null, modelName: null }
  try {
    const parsed = parseUniqueModelId(source.modelId as UniqueModelId)
    return { providerId: parsed.providerId || null, modelId: parsed.modelId || null, modelName: null }
  } catch {
    return { providerId: null, modelId: source.modelId, modelName: null }
  }
}

function resolveLegacyCost(stats: MessageStats): LegacyAggregateInput['cost'] {
  const cost = [...(stats.costs ?? [])].sort((left, right) => left.currency.localeCompare(right.currency))[0]
  if (!cost) return undefined
  return {
    amount: cost.amount,
    currency: cost.currency as Currency,
    source: cost.providerReportedRequestCount > 0 ? 'provider' : 'computed'
  }
}

function toLegacyAggregate(source: AiUsageRecordSourceRow): LegacyAggregateInput | null {
  const stats = source.stats
  if (!stats || !hasUsageSignal(stats)) return null

  const model = resolveLegacyModel(source)
  const snapshot = source.messageSnapshot
  return {
    requestId: `legacy:${source.messageKind}:${source.id}`,
    requestCount: Math.max(1, stats.estimatedRequestCount ?? stats.requestCount ?? 1),
    messageRef: { kind: source.messageKind, id: source.id },
    providerId: model.providerId,
    providerName: null,
    modelId: model.modelId,
    modelName: model.modelName,
    source: snapshot
      ? {
          type: source.messageKind === 'chat' ? 'assistant' : 'agent',
          id: snapshot.id,
          name: snapshot.name,
          icon: snapshot.emoji ?? null
        }
      : null,
    usage: {
      ...(stats.inputTokens !== undefined ? { inputTokens: stats.inputTokens } : {}),
      ...(stats.outputTokens !== undefined ? { outputTokens: stats.outputTokens } : {}),
      ...(stats.totalTokens !== undefined ? { totalTokens: stats.totalTokens } : {}),
      ...(stats.outputTokenDetails?.reasoningTokens !== undefined
        ? { reasoningTokens: stats.outputTokenDetails.reasoningTokens }
        : {}),
      ...(stats.inputTokenDetails?.noCacheTokens !== undefined
        ? { noCacheTokens: stats.inputTokenDetails.noCacheTokens }
        : {}),
      ...(stats.inputTokenDetails?.cacheReadTokens !== undefined
        ? { cacheReadTokens: stats.inputTokenDetails.cacheReadTokens }
        : {}),
      ...(stats.inputTokenDetails?.cacheWriteTokens !== undefined
        ? { cacheWriteTokens: stats.inputTokenDetails.cacheWriteTokens }
        : {})
    },
    cost: resolveLegacyCost(stats),
    modality: 'language',
    createdAt: source.createdAt
  }
}

export class AiUsageRecordMigrator extends BaseMigrator {
  readonly id = 'ai-usage-record'
  readonly name = 'AI Usage Records'
  readonly description = 'Project migrated message usage into immutable legacy aggregate records'
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
    if (this.preparedCount === 0) this.preparedCount = countCandidateRows(ctx.db)
    this.sourceCount = 0
    this.skippedCount = 0
    this.insertedCount = 0
    const warnings: string[] = []
    const readers = [readChatCandidateRows, readAgentSessionCandidateRows]
    const batchSize = 500

    for (const readBatch of readers) {
      let afterId: string | undefined
      while (true) {
        const candidates = readBatch(ctx.db, afterId, batchSize)
        if (candidates.length === 0) break
        this.sourceCount += candidates.length
        const inputs = candidates.map(toLegacyAggregate).filter((input): input is LegacyAggregateInput => {
          if (input) return true
          this.skippedCount += 1
          return false
        })

        if (inputs.length > 0) {
          try {
            let inserted = 0
            ctx.db.transaction((tx) => {
              inserted = aiUsageRecordService.recordLegacyAggregatesTx(tx, inputs)
            })
            this.insertedCount += inserted
          } catch (error) {
            logger.warn('Failed to insert legacy usage batch, retrying row by row', {
              batchSize: inputs.length,
              error
            })
            let skipped = 0
            for (const input of inputs) {
              try {
                let inserted = 0
                ctx.db.transaction((tx) => {
                  inserted = aiUsageRecordService.recordLegacyAggregatesTx(tx, [input])
                })
                this.insertedCount += inserted
              } catch (rowError) {
                skipped += 1
                logger.warn('Failed to insert legacy usage record, skipping it', {
                  requestId: input.requestId,
                  error: rowError
                })
              }
            }
            this.skippedCount += skipped
            if (skipped > 0) warnings.push(`Skipped ${skipped} AI usage record(s) after individual retries`)
          }
        }

        afterId = candidates.at(-1)?.id
        const progress = this.preparedCount === 0 ? 100 : Math.min(100, (this.sourceCount / this.preparedCount) * 100)
        this.reportProgress(progress, `Processed ${this.sourceCount}/${this.preparedCount} AI usage candidates`)
        if (candidates.length < batchSize) break
      }
    }

    this.assertOwnedForeignKeys(ctx.db, [aiUsageRecordTable])
    if (this.sourceCount === 0) this.reportProgress(100, 'No AI usage candidates to migrate')
    return { success: true, processedCount: this.insertedCount, ...(warnings.length > 0 ? { warnings } : {}) }
  }

  async validate(ctx: MigrationContext): Promise<ValidateResult> {
    const targetCount =
      ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(aiUsageRecordTable)
        .where(eq(aiUsageRecordTable.recordKind, 'legacy-aggregate'))
        .get()?.count ?? 0
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
      stats: { sourceCount: this.sourceCount, targetCount, skippedCount: this.skippedCount },
      diagnostics: { insertedCount: this.insertedCount }
    }
  }
}
