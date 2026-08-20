/**
 * Translate History Service - handles translate history CRUD
 */

import { application } from '@application'
import { type InsertTranslateHistoryFileRefRow, translateHistoryFileRefTable } from '@data/db/schemas/fileRelations'
import { translateHistoryTable } from '@data/db/schemas/translateHistory'
import type { DbOrTx } from '@data/db/types'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type {
  CreateTranslateHistoryDto,
  TranslateHistoryListResponse,
  TranslateHistoryQuery,
  UpdateTranslateHistoryDto
} from '@shared/data/api/schemas/translate'
import { parsePersistedLangCode, type PersistedLangCode } from '@shared/data/preference/preferenceTypes'
import { type TranslateHistory, TranslateHistoryKindSchema } from '@shared/data/types/translate'
import type { SQL } from 'drizzle-orm'
import { and, eq, or, sql } from 'drizzle-orm'

import { asNumericKey, decodeListCursor, encodeCursor, keysetOrdering } from './utils/keysetCursor'
import { timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:TranslateHistoryService')

function rowToTranslateHistory(row: typeof translateHistoryTable.$inferSelect): TranslateHistory {
  return {
    id: row.id,
    kind: TranslateHistoryKindSchema.parse(row.kind),
    sourceText: row.sourceText,
    targetText: row.targetText,
    sourceLanguage: row.sourceLanguage === null ? null : parsePersistedLangCode(row.sourceLanguage),
    targetLanguage: row.targetLanguage === null ? null : parsePersistedLangCode(row.targetLanguage),
    star: row.star,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

/** What a file translation records, minus the generated columns. */
export interface CreateFileTranslateHistoryInput {
  /** Source file name, e.g. `paper.pdf`. */
  sourceText: string
  /** Translated file name, e.g. `paper.zh-CN.pdf`. */
  targetText: string
  sourceLanguage: PersistedLangCode | null
  targetLanguage: PersistedLangCode | null
  /** The generated file; every file translation has exactly one. */
  targetFileEntryId: string
  /** Best-effort reference to the original; registration can fail on a case-collision. */
  sourceFileEntryId?: string
}

export class TranslateHistoryService {
  /**
   * Record a finished file translation: the history row plus its
   * `translate_history_file_ref` rows, in the caller's transaction.
   *
   * One method rather than a `createTx` / `addFileRefsTx` pair (the shape
   * `JobService` uses) because a `kind='file'` row without refs is not a
   * representable state — the names in `sourceText`/`targetText` are display
   * labels with no way back to the files. Callers cannot write the row and
   * forget the refs if they cannot get at the row alone.
   *
   * Tx-scoped so the producing service (today `PdfTranslationService`) composes
   * it into the same `withWriteTx` its FileManager entries are compensated
   * against.
   */
  createFileTx(tx: DbOrTx, input: CreateFileTranslateHistoryInput): TranslateHistory {
    const [row] = tx
      .insert(translateHistoryTable)
      .values({
        kind: 'file',
        sourceText: input.sourceText,
        targetText: input.targetText,
        sourceLanguage: input.sourceLanguage,
        targetLanguage: input.targetLanguage
      })
      .returning()
      .all()

    if (!row) {
      throw DataApiErrorFactory.database(new Error('Insert did not return a row'), 'create file translate history')
    }

    const refs: InsertTranslateHistoryFileRefRow[] = [
      { sourceId: row.id, fileEntryId: input.targetFileEntryId, role: 'target' }
    ]
    if (input.sourceFileEntryId !== undefined) {
      refs.push({ sourceId: row.id, fileEntryId: input.sourceFileEntryId, role: 'source' })
    }
    tx.insert(translateHistoryFileRefTable).values(refs).run()

    logger.info('Created file translate history', { id: row.id, refCount: refs.length })
    return rowToTranslateHistory(row)
  }

  list(query: TranslateHistoryQuery): TranslateHistoryListResponse {
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

    const ordering = keysetOrdering(translateHistoryTable.createdAt, translateHistoryTable.id, {
      major: 'desc',
      tie: 'asc'
    })
    const conditions = [...filterConditions]
    const cursor = decodeListCursor(query.cursor, asNumericKey, 'translate-history')
    if (cursor) {
      conditions.push(ordering.where(cursor))
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined

    const rows = db
      .select()
      .from(translateHistoryTable)
      .where(where)
      .orderBy(...ordering.orderBy)
      .limit(limit + 1)
      .all()
    const [{ count }] = db
      .select({ count: sql<number>`count(*)` })
      .from(translateHistoryTable)
      .where(filterConditions.length > 0 ? and(...filterConditions) : undefined)
      .all()
    const pageRows = rows.slice(0, limit)

    return {
      items: pageRows.map(rowToTranslateHistory),
      total: count,
      nextCursor:
        rows.length > limit
          ? encodeCursor(pageRows[pageRows.length - 1].createdAt, pageRows[pageRows.length - 1].id)
          : undefined
    }
  }

  getById(id: string): TranslateHistory {
    const db = application.get('DbService').getDb()
    const [row] = db.select().from(translateHistoryTable).where(eq(translateHistoryTable.id, id)).limit(1).all()

    if (!row) {
      throw DataApiErrorFactory.notFound('TranslateHistory', id)
    }

    return rowToTranslateHistory(row)
  }

  create(dto: CreateTranslateHistoryDto): TranslateHistory {
    const db = application.get('DbService').getDb()

    const [row] = db
      .insert(translateHistoryTable)
      .values({
        // Explicit rather than leaning on the column default: the DataApi POST
        // surface mints text rows only, `kind='file'` goes through `createFileTx`.
        kind: 'text',
        sourceText: dto.sourceText,
        targetText: dto.targetText,
        sourceLanguage: dto.sourceLanguage,
        targetLanguage: dto.targetLanguage
      })
      .returning()
      .all()

    if (!row) {
      throw DataApiErrorFactory.database(new Error('Insert did not return a row'), 'create translate history')
    }

    logger.info('Created translate history', { id: row.id })
    return rowToTranslateHistory(row)
  }

  update(id: string, dto: UpdateTranslateHistoryDto): TranslateHistory {
    const db = application.get('DbService').getDb()

    return db.transaction((tx) => {
      const [current] = tx.select().from(translateHistoryTable).where(eq(translateHistoryTable.id, id)).limit(1).all()

      if (!current) {
        throw DataApiErrorFactory.notFound('TranslateHistory', id)
      }

      const currentHistory = rowToTranslateHistory(current)
      const changesFileSnapshot =
        dto.sourceText !== undefined ||
        dto.targetText !== undefined ||
        dto.sourceLanguage !== undefined ||
        dto.targetLanguage !== undefined
      if (currentHistory.kind === 'file' && changesFileSnapshot) {
        throw DataApiErrorFactory.invalidOperation('update file translate history', 'only star can be changed')
      }

      const updates: Partial<typeof translateHistoryTable.$inferInsert> = {}
      if (dto.sourceText !== undefined) updates.sourceText = dto.sourceText
      if (dto.targetText !== undefined) updates.targetText = dto.targetText
      if (dto.sourceLanguage !== undefined) updates.sourceLanguage = dto.sourceLanguage
      if (dto.targetLanguage !== undefined) updates.targetLanguage = dto.targetLanguage
      if (dto.star !== undefined) updates.star = dto.star

      if (Object.keys(updates).length === 0) {
        return currentHistory
      }

      const [row] = tx
        .update(translateHistoryTable)
        .set(updates)
        .where(eq(translateHistoryTable.id, id))
        .returning()
        .all()

      if (!row) {
        throw DataApiErrorFactory.notFound('TranslateHistory', id)
      }

      logger.info('Updated translate history', { id, changes: Object.keys(dto) })
      return rowToTranslateHistory(row)
    })
  }

  delete(id: string): void {
    const db = application.get('DbService').getDb()

    db.transaction((tx) => {
      const [row] = tx.select().from(translateHistoryTable).where(eq(translateHistoryTable.id, id)).limit(1).all()

      if (!row) {
        throw DataApiErrorFactory.notFound('TranslateHistory', id)
      }

      tx.delete(translateHistoryTable).where(eq(translateHistoryTable.id, id)).run()
    })

    logger.info('Deleted translate history', { id })
  }

  clearAll(): void {
    const db = application.get('DbService').getDb()
    db.delete(translateHistoryTable).run()
    logger.info('Cleared all translate histories')
  }
}

export const translateHistoryService = new TranslateHistoryService()
