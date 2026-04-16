/**
 * Translate Language Service - handles translate language CRUD
 *
 * langCode is the primary key (immutable after creation).
 */

import { application } from '@application'
import { isUniqueConstraintError } from '@data/db/errorUtils'
import { translateLanguageTable } from '@data/db/schemas/translateLanguage'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { CreateTranslateLanguageDto, UpdateTranslateLanguageDto } from '@shared/data/api/schemas/translate'
import type { TranslateLanguage } from '@shared/data/types/translate'
import { asc, eq } from 'drizzle-orm'

const logger = loggerService.withContext('DataApi:TranslateLanguageService')

function rowToTranslateLanguage(row: typeof translateLanguageTable.$inferSelect): TranslateLanguage {
  return {
    langCode: row.langCode,
    value: row.value,
    emoji: row.emoji,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString()
  }
}

export class TranslateLanguageService {
  async list(): Promise<TranslateLanguage[]> {
    const db = application.get('DbService').getDb()
    const rows = await db.select().from(translateLanguageTable).orderBy(asc(translateLanguageTable.createdAt))
    return rows.map(rowToTranslateLanguage)
  }

  async getByLangCode(langCode: string): Promise<TranslateLanguage> {
    const db = application.get('DbService').getDb()
    const [row] = await db
      .select()
      .from(translateLanguageTable)
      .where(eq(translateLanguageTable.langCode, langCode))
      .limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('TranslateLanguage', langCode)
    }

    return rowToTranslateLanguage(row)
  }

  async create(dto: CreateTranslateLanguageDto): Promise<TranslateLanguage> {
    const db = application.get('DbService').getDb()
    const langCode = dto.langCode.toLowerCase()

    try {
      const [row] = await db
        .insert(translateLanguageTable)
        .values({
          langCode,
          value: dto.value,
          emoji: dto.emoji
        })
        .returning()

      if (!row) {
        throw DataApiErrorFactory.database(new Error('Insert did not return a row'), 'create translate language')
      }

      logger.info('Created translate language', { langCode })
      return rowToTranslateLanguage(row)
    } catch (e: unknown) {
      // Drizzle wraps the libsql error in a DrizzleQueryError whose message
      // reads "Failed query: insert into ..."; the actual UNIQUE text sits on
      // `.cause`. `isUniqueConstraintError` walks the cause chain.
      if (isUniqueConstraintError(e)) {
        throw DataApiErrorFactory.conflict(`Language with code '${langCode}' already exists`, 'TranslateLanguage')
      }
      throw e
    }
  }

  async update(langCode: string, dto: UpdateTranslateLanguageDto): Promise<TranslateLanguage> {
    const db = application.get('DbService').getDb()

    return await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(translateLanguageTable)
        .where(eq(translateLanguageTable.langCode, langCode))
        .limit(1)

      if (!current) {
        throw DataApiErrorFactory.notFound('TranslateLanguage', langCode)
      }

      const updates: Partial<typeof translateLanguageTable.$inferInsert> = {}
      if (dto.value !== undefined) updates.value = dto.value
      if (dto.emoji !== undefined) updates.emoji = dto.emoji

      if (Object.keys(updates).length === 0) {
        return rowToTranslateLanguage(current)
      }

      const [row] = await tx
        .update(translateLanguageTable)
        .set(updates)
        .where(eq(translateLanguageTable.langCode, langCode))
        .returning()

      if (!row) {
        throw DataApiErrorFactory.notFound('TranslateLanguage', langCode)
      }

      logger.info('Updated translate language', { langCode, changes: Object.keys(dto) })
      return rowToTranslateLanguage(row)
    })
  }

  async delete(langCode: string): Promise<void> {
    const db = application.get('DbService').getDb()

    await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(translateLanguageTable)
        .where(eq(translateLanguageTable.langCode, langCode))
        .limit(1)

      if (!row) {
        throw DataApiErrorFactory.notFound('TranslateLanguage', langCode)
      }

      await tx.delete(translateLanguageTable).where(eq(translateLanguageTable.langCode, langCode))
    })

    logger.info('Deleted translate language', { langCode })
  }
}

export const translateLanguageService = new TranslateLanguageService()
