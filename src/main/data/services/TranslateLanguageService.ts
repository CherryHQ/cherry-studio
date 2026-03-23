/**
 * Translate Language Service - handles custom translate language CRUD
 */

import { dbService } from '@data/db/DbService'
import { translateLanguageTable } from '@data/db/schemas/translateLanguage'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type {
  CreateTranslateLanguageDto,
  TranslateLanguage,
  UpdateTranslateLanguageDto
} from '@shared/data/api/schemas/translate'
import { asc, eq } from 'drizzle-orm'

const logger = loggerService.withContext('DataApi:TranslateLanguageService')

function rowToTranslateLanguage(row: typeof translateLanguageTable.$inferSelect): TranslateLanguage {
  return {
    id: row.id,
    langCode: row.langCode,
    value: row.value,
    emoji: row.emoji,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString()
  }
}

export class TranslateLanguageService {
  private static instance: TranslateLanguageService

  private constructor() {}

  public static getInstance(): TranslateLanguageService {
    if (!TranslateLanguageService.instance) {
      TranslateLanguageService.instance = new TranslateLanguageService()
    }
    return TranslateLanguageService.instance
  }

  async list(): Promise<TranslateLanguage[]> {
    const db = dbService.getDb()
    const rows = await db.select().from(translateLanguageTable).orderBy(asc(translateLanguageTable.createdAt))
    return rows.map(rowToTranslateLanguage)
  }

  async getById(id: string): Promise<TranslateLanguage> {
    const db = dbService.getDb()
    const [row] = await db.select().from(translateLanguageTable).where(eq(translateLanguageTable.id, id)).limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('TranslateLanguage', id)
    }

    return rowToTranslateLanguage(row)
  }

  async create(dto: CreateTranslateLanguageDto): Promise<TranslateLanguage> {
    const db = dbService.getDb()
    const langCode = dto.langCode.toLowerCase()

    return await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(translateLanguageTable)
        .where(eq(translateLanguageTable.langCode, langCode))
        .limit(1)

      if (existing) {
        throw DataApiErrorFactory.invalidOperation(
          'create translate language',
          `Language with code '${langCode}' already exists`
        )
      }

      const [row] = await tx
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

      logger.info('Created translate language', { id: row.id, langCode })
      return rowToTranslateLanguage(row)
    })
  }

  async update(id: string, dto: UpdateTranslateLanguageDto): Promise<TranslateLanguage> {
    const db = dbService.getDb()

    return await db.transaction(async (tx) => {
      // Verify existence within transaction
      const [current] = await tx.select().from(translateLanguageTable).where(eq(translateLanguageTable.id, id)).limit(1)

      if (!current) {
        throw DataApiErrorFactory.notFound('TranslateLanguage', id)
      }

      const updates: Partial<typeof translateLanguageTable.$inferInsert> = {}
      if (dto.langCode !== undefined) updates.langCode = dto.langCode.toLowerCase()
      if (dto.value !== undefined) updates.value = dto.value
      if (dto.emoji !== undefined) updates.emoji = dto.emoji

      if (Object.keys(updates).length === 0) {
        return rowToTranslateLanguage(current)
      }

      // If updating langCode, check uniqueness within same transaction
      if (updates.langCode !== undefined) {
        const [existing] = await tx
          .select()
          .from(translateLanguageTable)
          .where(eq(translateLanguageTable.langCode, updates.langCode))
          .limit(1)

        if (existing && existing.id !== id) {
          throw DataApiErrorFactory.invalidOperation(
            'update translate language',
            `Language with code '${updates.langCode}' already exists`
          )
        }
      }

      const [row] = await tx
        .update(translateLanguageTable)
        .set(updates)
        .where(eq(translateLanguageTable.id, id))
        .returning()

      if (!row) {
        throw DataApiErrorFactory.notFound('TranslateLanguage', id)
      }

      logger.info('Updated translate language', { id, changes: Object.keys(dto) })
      return rowToTranslateLanguage(row)
    })
  }

  async delete(id: string): Promise<void> {
    const db = dbService.getDb()

    await db.transaction(async (tx) => {
      const [row] = await tx.select().from(translateLanguageTable).where(eq(translateLanguageTable.id, id)).limit(1)

      if (!row) {
        throw DataApiErrorFactory.notFound('TranslateLanguage', id)
      }

      await tx.delete(translateLanguageTable).where(eq(translateLanguageTable.id, id))
    })

    logger.info('Deleted translate language', { id })
  }
}

export const translateLanguageService = TranslateLanguageService.getInstance()
