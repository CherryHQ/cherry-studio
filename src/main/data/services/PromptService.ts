/**
 * Prompt Service - handles prompt CRUD and ordering
 *
 * Invariants maintained by this service:
 * - Ordering: whole-table fractional-indexing `orderKey`. Reorder paths go
 *   through `applyMoves`; callers never touch `orderKey` directly.
 */

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { assistantTable } from '@data/db/schemas/assistant'
import { promptBindingTable, promptTable } from '@data/db/schemas/prompt'
import type { DbType } from '@data/db/types'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { CreatePromptDto, ListPromptsQuery, UpdatePromptDto } from '@shared/data/api/schemas/prompts'
import type { Prompt, PromptBindingTarget, PromptBindingTargetType } from '@shared/data/types/prompt'
import { and, asc, eq, inArray, isNull, or, type SQL, sql } from 'drizzle-orm'

import { applyMoves, insertWithOrderKey } from './utils/orderKey'
import { nullsToUndefined, timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:PromptService')

function rowToPrompt(row: typeof promptTable.$inferSelect): Prompt {
  const clean = nullsToUndefined(row)
  return {
    ...clean,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

/**
 * Extract any `before`/`after` id referenced by a set of anchors. Reorder
 * callers feed these into the existence pre-check so that a missing anchor
 * surfaces as `NOT_FOUND` from the handler, not a 500 from `applyMoves`.
 */
function collectAnchorIds(anchors: OrderRequest[]): string[] {
  const ids: string[] = []
  for (const anchor of anchors) {
    if ('before' in anchor) ids.push(anchor.before)
    if ('after' in anchor) ids.push(anchor.after)
  }
  return ids
}

export class PromptService {
  private get db() {
    return application.get('DbService').getDb()
  }

  list(query: ListPromptsQuery = {}): Prompt[] {
    // Canonical API order is old → new; settings UI reverses this for display.
    const conditions: SQL[] = []
    if (query.search) {
      const pattern = `%${query.search.replace(/[\\%_]/g, '\\$&')}%`
      const titleMatch = sql`${promptTable.title} LIKE ${pattern} ESCAPE '\\'`
      const contentMatch = sql`${promptTable.content} LIKE ${pattern} ESCAPE '\\'`
      const searchClause = or(titleMatch, contentMatch)
      if (searchClause) conditions.push(searchClause)
    }

    if ('targetType' in query) {
      const rows = this.db
        .select({ prompt: promptTable })
        .from(promptTable)
        .innerJoin(promptBindingTable, eq(promptBindingTable.promptId, promptTable.id))
        .where(
          and(
            eq(promptBindingTable.targetType, query.targetType),
            eq(promptBindingTable.targetId, query.targetId),
            ...conditions
          )
        )
        .orderBy(asc(promptTable.orderKey))
        .all()
      return rows.map((row) => rowToPrompt(row.prompt))
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined
    const rows = this.db.select().from(promptTable).where(whereClause).orderBy(asc(promptTable.orderKey)).all()
    return rows.map(rowToPrompt)
  }

  getById(id: string): Prompt {
    const [row] = this.db.select().from(promptTable).where(eq(promptTable.id, id)).limit(1).all()
    if (!row) {
      throw DataApiErrorFactory.notFound('Prompt', id)
    }
    return rowToPrompt(row)
  }

  create(dto: CreatePromptDto): Prompt {
    return application.get('DbService').withWriteTx((tx) => {
      if (dto.bindingTarget) {
        this.assertBindingTargetExistsTx(tx, dto.bindingTarget)
      }

      const inserted = insertWithOrderKey(
        tx,
        promptTable,
        {
          title: dto.title,
          content: dto.content
        },
        { pkColumn: promptTable.id }
      )
      const row = inserted as typeof promptTable.$inferSelect

      if (dto.bindingTarget) {
        tx.insert(promptBindingTable)
          .values({
            promptId: row.id,
            targetType: dto.bindingTarget.type,
            targetId: dto.bindingTarget.id
          })
          .run()
      }

      logger.info('Created prompt', { id: row.id, bindingTarget: dto.bindingTarget })
      return rowToPrompt(row)
    })
  }

  bindToTarget(promptId: string, target: PromptBindingTarget): void {
    application.get('DbService').withWriteTx((tx) => {
      this.assertPromptExistsTx(tx, promptId)
      this.assertBindingTargetExistsTx(tx, target)
      tx.insert(promptBindingTable)
        .values({ promptId, targetType: target.type, targetId: target.id })
        .onConflictDoNothing()
        .run()
    })
    logger.info('Bound prompt to target', { promptId, target })
  }

  unbindFromTarget(promptId: string, target: PromptBindingTarget): void {
    application.get('DbService').withWriteTx((tx) => {
      this.assertPromptExistsTx(tx, promptId)
      tx.delete(promptBindingTable)
        .where(
          and(
            eq(promptBindingTable.promptId, promptId),
            eq(promptBindingTable.targetType, target.type),
            eq(promptBindingTable.targetId, target.id)
          )
        )
        .run()
    })
    logger.info('Unbound prompt from target', { promptId, target })
  }

  purgeForTargetTx(tx: Pick<DbType, 'delete'>, targetType: PromptBindingTargetType, targetId: string): void {
    tx.delete(promptBindingTable)
      .where(and(eq(promptBindingTable.targetType, targetType), eq(promptBindingTable.targetId, targetId)))
      .run()
    logger.info('Purged prompt bindings for target', { targetType, targetId })
  }

  update(id: string, dto: UpdatePromptDto): Prompt {
    return this.db.transaction((tx) => {
      const updates: Partial<typeof promptTable.$inferInsert> = {}
      if (dto.title !== undefined) updates.title = dto.title
      if (dto.content !== undefined) updates.content = dto.content

      const result = tx.update(promptTable).set(updates).where(eq(promptTable.id, id)).run()
      if (result.changes === 0) {
        throw DataApiErrorFactory.notFound('Prompt', id)
      }

      const [row] = tx.select().from(promptTable).where(eq(promptTable.id, id)).limit(1).all()
      if (!row) {
        throw DataApiErrorFactory.notFound('Prompt', id)
      }

      logger.info('Updated prompt', { id, changes: Object.keys(dto) })
      return rowToPrompt(row)
    })
  }

  /** Move a single prompt relative to an anchor. */
  reorder(id: string, anchor: OrderRequest): void {
    this.db.transaction((tx) => {
      this.assertPromptsExistTx(tx, [id, ...collectAnchorIds([anchor])])
      applyMoves(tx, promptTable, [{ id, anchor }], { pkColumn: promptTable.id })
    })
  }

  /** Apply a batch of moves atomically. */
  reorderBatch(moves: Array<{ id: string; anchor: OrderRequest }>): void {
    if (moves.length === 0) return
    this.db.transaction((tx) => {
      this.assertPromptsExistTx(tx, [...moves.map((m) => m.id), ...collectAnchorIds(moves.map((m) => m.anchor))])
      applyMoves(tx, promptTable, moves, { pkColumn: promptTable.id })
    })
  }

  /** Pre-check that every id in a reorder exists; convert to NOT_FOUND otherwise. */
  private assertPromptsExistTx(tx: Pick<DbType, 'select'>, ids: string[]): void {
    const uniqueIds = Array.from(new Set(ids))
    const rows = tx
      .select({ id: promptTable.id })
      .from(promptTable)
      .where(inArray(promptTable.id, uniqueIds))
      .all() as Array<{ id: string }>
    if (rows.length === uniqueIds.length) return
    const found = new Set(rows.map((r) => r.id))
    const missing = uniqueIds.find((id) => !found.has(id)) ?? uniqueIds[0]
    throw DataApiErrorFactory.notFound('Prompt', missing)
  }

  private assertPromptExistsTx(tx: Pick<DbType, 'select'>, id: string): void {
    const row = tx.select({ id: promptTable.id }).from(promptTable).where(eq(promptTable.id, id)).limit(1).get()
    if (!row) {
      throw DataApiErrorFactory.notFound('Prompt', id)
    }
  }

  private assertBindingTargetExistsTx(tx: Pick<DbType, 'select'>, target: PromptBindingTarget): void {
    const row =
      target.type === 'assistant'
        ? tx
            .select({ id: assistantTable.id })
            .from(assistantTable)
            .where(and(eq(assistantTable.id, target.id), isNull(assistantTable.deletedAt)))
            .limit(1)
            .get()
        : tx
            .select({ id: agentTable.id })
            .from(agentTable)
            .where(and(eq(agentTable.id, target.id), isNull(agentTable.deletedAt)))
            .limit(1)
            .get()
    if (!row) {
      throw DataApiErrorFactory.notFound(target.type === 'assistant' ? 'Assistant' : 'Agent', target.id)
    }
  }

  delete(id: string): void {
    const result = this.db.delete(promptTable).where(eq(promptTable.id, id)).run()
    if (result.changes === 0) {
      throw DataApiErrorFactory.notFound('Prompt', id)
    }
    logger.info('Deleted prompt', { id })
  }
}

export const promptService = new PromptService()
