/**
 * Translate History Service - handles translate history CRUD
 */

import { application } from '@application'
import { translateHistoryTable } from '@data/db/schemas/translateHistory'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type {
  CreateTranslateHistoryDto,
  TranslateHistoryListResponse,
  TranslateHistoryQuery,
  UpdateTranslateHistoryDto
} from '@shared/data/api/schemas/translate'
import { parsePersistedLangCode } from '@shared/data/preference/preferenceTypes'
import type { TranslateHistory } from '@shared/data/types/translate'
import type { SQL } from 'drizzle-orm'
import { and, asc, desc, eq, gt, lt, or, sql } from 'drizzle-orm'

import { timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:TranslateHistoryService')

type TranslateHistoryRow = typeof translateHistoryTable.$inferSelect
type TranslateHistoryCursor = { createdAt: number; id: string } | null

function decodeCursor(raw: string | undefined): TranslateHistoryCursor {
  if (!raw) return null

  const separator = raw.indexOf(':')
  if (separator < 0) return warnAndFallback(raw, 'missing separator')

  const createdAt = Number(raw.slice(0, separator))
  const id = raw.slice(separator + 1)
  if (!Number.isFinite(createdAt) || !id) {
    return warnAndFallback(raw, 'malformed createdAt or id')
  }

  return { createdAt, id }
}

function warnAndFallback(raw: string, reason: string): TranslateHistoryCursor {
  logger.warn('decodeCursor: cursor unparseable, falling back to first page', { cursor: raw, reason })
  return null
}

function encodeCursor(row: TranslateHistoryRow): string {
  return `${row.createdAt}:${row.id}`
}

function rowToTranslateHistory(row: typeof translateHistoryTable.$inferSelect): TranslateHistory {
  return {
    id: row.id,
    sourceText: row.sourceText,
    targetText: row.targetText,
    sourceLanguage: row.sourceLanguage === null ? null : parsePersistedLangCode(row.sourceLanguage),
    targetLanguage: row.targetLanguage === null ? null : parsePersistedLangCode(row.targetLanguage),
    star: row.star,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

export class TranslateHistoryService {
  async list(query: TranslateHistoryQuery): Promise<TranslateHistoryListResponse> {
    const db = application.get('DbService').getDb()
    const { limit } = query

    const filterConditions: SQL[] = []

    if (query?.star !== undefined) {
      filterConditions.push(eq(translateHistoryTable.star, query.star))
    }

    if (query?.search) {
      const escaped = query.search.replace(/[%_\\]/g, '\\$&')
      const pattern = `%${escaped}%`
      const searchCondition = or(
        sql`${translateHistoryTable.sourceText} LIKE ${pattern} ESCAPE '\\'`,
        sql`${translateHistoryTable.targetText} LIKE ${pattern} ESCAPE '\\'`
      )
      if (searchCondition) {
        filterConditions.push(searchCondition)
      }
    }

    const conditions = [...filterConditions]
    const cursor = decodeCursor(query.cursor)
    if (cursor) {
      conditions.push(
        or(
          lt(translateHistoryTable.createdAt, cursor.createdAt),
          and(eq(translateHistoryTable.createdAt, cursor.createdAt), gt(translateHistoryTable.id, cursor.id))
        )!
      )
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined

    const [rows, [{ count }]] = await Promise.all([
      db
        .select()
        .from(translateHistoryTable)
        .where(where)
        .orderBy(desc(translateHistoryTable.createdAt), asc(translateHistoryTable.id))
        .limit(limit + 1),
      db
        .select({ count: sql<number>`count(*)` })
        .from(translateHistoryTable)
        .where(filterConditions.length > 0 ? and(...filterConditions) : undefined)
    ])
    const pageRows = rows.slice(0, limit)

    return {
      items: pageRows.map(rowToTranslateHistory),
      total: count,
      nextCursor: rows.length > limit ? encodeCursor(pageRows[pageRows.length - 1]) : undefined
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
