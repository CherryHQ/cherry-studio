/**
 * Prompt Service - handles prompt CRUD and ordering
 *
 * Invariants maintained by this service:
 * - Ordering: whole-table fractional-indexing `orderKey`. Reorder paths go
 *   through `applyMoves`; callers never touch `orderKey` directly.
 */

import { application } from '@application'
import { promptTable } from '@data/db/schemas/prompt'
import type { DbType } from '@data/db/types'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { CreatePromptDto, ListPromptsQuery, UpdatePromptDto } from '@shared/data/api/schemas/prompts'
import type { Prompt } from '@shared/data/types/prompt'
import { and, asc, eq, inArray, or, type SQL, sql } from 'drizzle-orm'

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

  async list(query: ListPromptsQuery = {}): Promise<Prompt[]> {
    // Canonical API order is old → new; settings UI reverses this for display.
    const conditions: SQL[] = []
    if (query.search) {
      const pattern = `%${query.search.replace(/[\\%_]/g, '\\$&')}%`
      const titleMatch = sql`${promptTable.title} LIKE ${pattern} ESCAPE '\\'`
      const contentMatch = sql`${promptTable.content} LIKE ${pattern} ESCAPE '\\'`
      const searchClause = or(titleMatch, contentMatch)
      if (searchClause) conditions.push(searchClause)
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined
    const rows = await this.db.select().from(promptTable).where(whereClause).orderBy(asc(promptTable.orderKey))
    return rows.map(rowToPrompt)
  }

  async getById(id: string): Promise<Prompt> {
    const [row] = await this.db.select().from(promptTable).where(eq(promptTable.id, id)).limit(1)
    if (!row) {
      throw DataApiErrorFactory.notFound('Prompt', id)
    }
    return rowToPrompt(row)
  }

  async create(dto: CreatePromptDto): Promise<Prompt> {
    return this.db.transaction(async (tx) => {
      const inserted = await insertWithOrderKey(
        tx,
        promptTable,
        {
          title: dto.title,
          content: dto.content
        },
        { pkColumn: promptTable.id }
      )
      const row = inserted as typeof promptTable.$inferSelect

      logger.info('Created prompt', { id: row.id })
      return rowToPrompt(row)
    })
  }

  async update(id: string, dto: UpdatePromptDto): Promise<Prompt> {
    return this.db.transaction(async (tx) => {
      const updates: Partial<typeof promptTable.$inferInsert> = {}
      if (dto.title !== undefined) updates.title = dto.title
      if (dto.content !== undefined) updates.content = dto.content

      const result = await tx.update(promptTable).set(updates).where(eq(promptTable.id, id))
      if (result.rowsAffected === 0) {
        throw DataApiErrorFactory.notFound('Prompt', id)
      }

      const [row] = await tx.select().from(promptTable).where(eq(promptTable.id, id)).limit(1)
      if (!row) {
        throw DataApiErrorFactory.notFound('Prompt', id)
      }

      logger.info('Updated prompt', { id, changes: Object.keys(dto) })
      return rowToPrompt(row)
    })
  }

  /** Move a single prompt relative to an anchor. */
  async reorder(id: string, anchor: OrderRequest): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.assertPromptsExistTx(tx, [id, ...collectAnchorIds([anchor])])
      await applyMoves(tx, promptTable, [{ id, anchor }], { pkColumn: promptTable.id })
    })
  }

  /** Apply a batch of moves atomically. */
  async reorderBatch(moves: Array<{ id: string; anchor: OrderRequest }>): Promise<void> {
    if (moves.length === 0) return
    await this.db.transaction(async (tx) => {
      await this.assertPromptsExistTx(tx, [...moves.map((m) => m.id), ...collectAnchorIds(moves.map((m) => m.anchor))])
      await applyMoves(tx, promptTable, moves, { pkColumn: promptTable.id })
    })
  }

  /** Pre-check that every id in a reorder exists; convert to NOT_FOUND otherwise. */
  private async assertPromptsExistTx(tx: Pick<DbType, 'select'>, ids: string[]): Promise<void> {
    const uniqueIds = Array.from(new Set(ids))
    const rows = (await tx
      .select({ id: promptTable.id })
      .from(promptTable)
      .where(inArray(promptTable.id, uniqueIds))) as Array<{ id: string }>
    if (rows.length === uniqueIds.length) return
    const found = new Set(rows.map((r) => r.id))
    const missing = uniqueIds.find((id) => !found.has(id)) ?? uniqueIds[0]
    throw DataApiErrorFactory.notFound('Prompt', missing)
  }

  async delete(id: string): Promise<void> {
    const result = await this.db.delete(promptTable).where(eq(promptTable.id, id))
    if (result.rowsAffected === 0) {
      throw DataApiErrorFactory.notFound('Prompt', id)
    }
    logger.info('Deleted prompt', { id })
  }
}

export const promptService = new PromptService()
