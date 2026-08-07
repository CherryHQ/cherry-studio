/**
 * Translate Language Service - handles translate language CRUD
 *
 * langCode is the primary key (immutable after creation).
 */

import { application } from '@application'
import { translateLanguageTable } from '@data/db/schemas/translateLanguage'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { CreateTranslateLanguageDto, UpdateTranslateLanguageDto } from '@shared/data/api/schemas/translate'
import { parsePersistedLangCode } from '@shared/data/preference/preferenceTypes'
import type { TranslateLanguage } from '@shared/data/types/translate'
import { asc, eq } from 'drizzle-orm'

import { timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:TranslateLanguageService')

function rowToTranslateLanguage(row: typeof translateLanguageTable.$inferSelect): TranslateLanguage {
  return {
    langCode: parsePersistedLangCode(row.langCode),
    value: row.value,
    emoji: row.emoji,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

export class TranslateLanguageService {
  list(): TranslateLanguage[] {
    const db = application.get('DbService').getDb()
    const rows = db.select().from(translateLanguageTable).orderBy(asc(translateLanguageTable.createdAt)).all()
    return rows.map(rowToTranslateLanguage)
  }

  getByLangCode(langCode: string): TranslateLanguage {
    const db = application.get('DbService').getDb()
    const [row] = db
      .select()
      .from(translateLanguageTable)
      .where(eq(translateLanguageTable.langCode, langCode))
      .limit(1)
      .all()

    if (!row) {
      throw DataApiErrorFactory.notFound('TranslateLanguage', langCode)
    }

    return rowToTranslateLanguage(row)
  }

  create(dto: CreateTranslateLanguageDto): TranslateLanguage {
    const db = application.get('DbService').getDb()
    const langCode = parsePersistedLangCode(dto.langCode.toLowerCase())

    const [row] = withSqliteErrors(
      () =>
        db
          .insert(translateLanguageTable)
          .values({
            langCode,
            value: dto.value,
            emoji: dto.emoji
          })
          .returning()
          .all(),
      defaultHandlersFor('TranslateLanguage', langCode)
    )

    if (!row) {
      throw DataApiErrorFactory.database(new Error('Insert did not return a row'), 'create translate language')
    }

    logger.info('Created translate language', { langCode })
    return rowToTranslateLanguage(row)
  }

  update(langCode: string, dto: UpdateTranslateLanguageDto): TranslateLanguage {
    const db = application.get('DbService').getDb()

    return db.transaction((tx) => {
      const [current] = tx
        .select()
        .from(translateLanguageTable)
        .where(eq(translateLanguageTable.langCode, langCode))
        .limit(1)
        .all()

      if (!current) {
        throw DataApiErrorFactory.notFound('TranslateLanguage', langCode)
      }

      const updates: Partial<typeof translateLanguageTable.$inferInsert> = {}
      if (dto.value !== undefined) updates.value = dto.value
      if (dto.emoji !== undefined) updates.emoji = dto.emoji

      if (Object.keys(updates).length === 0) {
        return rowToTranslateLanguage(current)
      }

      const [row] = tx
        .update(translateLanguageTable)
        .set(updates)
        .where(eq(translateLanguageTable.langCode, langCode))
        .returning()
        .all()

      if (!row) {
        throw DataApiErrorFactory.notFound('TranslateLanguage', langCode)
      }

      logger.info('Updated translate language', { langCode, changes: Object.keys(dto) })
      return rowToTranslateLanguage(row)
    })
  }

  delete(langCode: string): void {
    const db = application.get('DbService').getDb()

    db.transaction((tx) => {
      const [row] = tx
        .select()
        .from(translateLanguageTable)
        .where(eq(translateLanguageTable.langCode, langCode))
        .limit(1)
        .all()

      if (!row) {
        throw DataApiErrorFactory.notFound('TranslateLanguage', langCode)
      }

      tx.delete(translateLanguageTable).where(eq(translateLanguageTable.langCode, langCode)).run()
    })

    logger.info('Deleted translate language', { langCode })
  }
}

export const translateLanguageService = new TranslateLanguageService()
