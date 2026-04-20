/**
 * Translate History Service - handles translate history CRUD
 */

import { application } from '@application'
import { translateHistoryTable } from '@data/db/schemas/translateHistory'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { OffsetPaginationResponse } from '@shared/data/api/apiTypes'
import type {
  CreateTranslateHistoryDto,
  TranslateHistoryQuery,
  UpdateTranslateHistoryDto
} from '@shared/data/api/schemas/translate'
import type { TranslateHistory } from '@shared/data/types/translate'
import type { SQL } from 'drizzle-orm'
import { and, desc, eq, or, sql } from 'drizzle-orm'

const logger = loggerService.withContext('DataApi:TranslateHistoryService')

function rowToTranslateHistory(row: typeof translateHistoryTable.$inferSelect): TranslateHistory {
  return {
    id: row.id,
    sourceText: row.sourceText,
    targetText: row.targetText,
    sourceLanguage: row.sourceLanguage,
    targetLanguage: row.targetLanguage,
    star: row.star,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString()
  }
}

export class TranslateHistoryService {
  async list(query: TranslateHistoryQuery): Promise<OffsetPaginationResponse<TranslateHistory>> {
    const db = application.get('DbService').getDb()
    const { page, limit } = query
    const offset = (page - 1) * limit

    const conditions: SQL[] = []

    if (query?.star !== undefined) {
      conditions.push(eq(translateHistoryTable.star, query.star))
    }

    if (query?.search) {
      const escaped = query.search.replace(/[%_\\]/g, '\\$&')
      const pattern = `%${escaped}%`
      const searchCondition = or(
        sql`${translateHistoryTable.sourceText} LIKE ${pattern} ESCAPE '\\'`,
        sql`${translateHistoryTable.targetText} LIKE ${pattern} ESCAPE '\\'`
      )
      if (searchCondition) {
        conditions.push(searchCondition)
      }
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined

    const [items, [{ count }]] = await Promise.all([
      db
        .select()
        .from(translateHistoryTable)
        .where(where)
        .orderBy(desc(translateHistoryTable.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(translateHistoryTable).where(where)
    ])

    return {
      items: items.map(rowToTranslateHistory),
      total: count,
      page
    }
  }

  async getById(id: string): Promise<TranslateHistory> {
    const db = application.get('DbService').getDb()
    const [row] = await db.select().from(translateHistoryTable).where(eq(translateHistoryTable.id, id)).limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('TranslateHistory', id)
    }

    return rowToTranslateHistory(row)
  }

  async create(dto: CreateTranslateHistoryDto): Promise<TranslateHistory> {
    const db = application.get('DbService').getDb()

    const [row] = await db
      .insert(translateHistoryTable)
      .values({
        sourceText: dto.sourceText,
        targetText: dto.targetText,
        sourceLanguage: dto.sourceLanguage,
        targetLanguage: dto.targetLanguage
      })
      .returning()

    if (!row) {
      throw DataApiErrorFactory.database(new Error('Insert did not return a row'), 'create translate history')
    }

    logger.info('Created translate history', { id: row.id })
    return rowToTranslateHistory(row)
  }

  async update(id: string, dto: UpdateTranslateHistoryDto): Promise<TranslateHistory> {
    const db = application.get('DbService').getDb()

    return await db.transaction(async (tx) => {
      const [current] = await tx.select().from(translateHistoryTable).where(eq(translateHistoryTable.id, id)).limit(1)

      if (!current) {
        throw DataApiErrorFactory.notFound('TranslateHistory', id)
      }

      const updates: Partial<typeof translateHistoryTable.$inferInsert> = {}
      if (dto.sourceText !== undefined) updates.sourceText = dto.sourceText
      if (dto.targetText !== undefined) updates.targetText = dto.targetText
      if (dto.sourceLanguage !== undefined) updates.sourceLanguage = dto.sourceLanguage
      if (dto.targetLanguage !== undefined) updates.targetLanguage = dto.targetLanguage
      if (dto.star !== undefined) updates.star = dto.star

      if (Object.keys(updates).length === 0) {
        return rowToTranslateHistory(current)
      }

      const [row] = await tx
        .update(translateHistoryTable)
        .set(updates)
        .where(eq(translateHistoryTable.id, id))
        .returning()

      if (!row) {
        throw DataApiErrorFactory.notFound('TranslateHistory', id)
      }

      logger.info('Updated translate history', { id, changes: Object.keys(dto) })
      return rowToTranslateHistory(row)
    })
  }

  async delete(id: string): Promise<void> {
    const db = application.get('DbService').getDb()

    await db.transaction(async (tx) => {
      const [row] = await tx.select().from(translateHistoryTable).where(eq(translateHistoryTable.id, id)).limit(1)

      if (!row) {
        throw DataApiErrorFactory.notFound('TranslateHistory', id)
      }

      await tx.delete(translateHistoryTable).where(eq(translateHistoryTable.id, id))
    })

    logger.info('Deleted translate history', { id })
  }

  async clearAll(): Promise<void> {
    const db = application.get('DbService').getDb()
    await db.delete(translateHistoryTable)
    logger.info('Cleared all translate histories')
  }
}

export const translateHistoryService = new TranslateHistoryService()
