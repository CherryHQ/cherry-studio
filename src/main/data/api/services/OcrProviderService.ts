import { loggerService } from '@logger'
import { dbService } from '@main/data/db/DbService'
import { ocrProviderTable } from '@main/data/db/schemas/ocrProvider'
import type { PaginationParams, ServiceOptions } from '@shared/data/api/apiTypes'
import type { DbOcrProvider, DbOcrProviderCreate, DbOcrProviderReplace, DbOcrProviderUpdate } from '@types'
import { BuiltinOcrProviderIds, isDbOcrProvider } from '@types'
import dayjs from 'dayjs'
import { eq } from 'drizzle-orm'
import { merge } from 'lodash'

import type { IBaseService } from './IBaseService'

const logger = loggerService.withContext('OcrProviderService')

/**
 * Service layer for OCR providers
 * Implements the standard service interface and handles all OCR provider operations
 * NOTE: Not completely finished since data architecture is not completely designed and implemented.
 *       It's a early version.
 */
export class OcrProviderService implements IBaseService<DbOcrProvider, DbOcrProviderCreate, DbOcrProviderUpdate> {
  /**
   * Find OCR provider by ID
   */
  async findById(id: string, _options?: ServiceOptions): Promise<DbOcrProvider | null> {
    try {
      const providers = await dbService
        .getDb()
        .select()
        .from(ocrProviderTable)
        .where(eq(ocrProviderTable.id, id))
        .limit(1)

      if (providers.length === 0) {
        logger.warn(`OCR provider ${id} not found`)
        return null
      }

      logger.debug(`Retrieved OCR provider: ${id}`)
      return providers[0]
    } catch (error) {
      logger.error(`Failed to find OCR provider ${id}`, error as Error)
      throw error
    }
  }

  /**
   * Find multiple OCR providers with pagination
   */
  async findMany(
    params: PaginationParams & Record<string, any>,
    _options?: ServiceOptions
  ): Promise<{
    items: DbOcrProvider[]
    total: number
    hasNext?: boolean
    nextCursor?: string
  }> {
    try {
      const { page = 1, limit = 20, cursor } = params

      let providers = await dbService.getDb().select().from(ocrProviderTable)

      // Apply filters if provided
      if (params.registered) {
        // This filter would need access to the OCR service registry
        // For now, we'll return all providers and let the service layer filter
        logger.debug('Registered filter requested - returning all providers for service layer filtering')
      }

      const total = providers.length

      // Apply pagination
      if (cursor) {
        // Cursor-based pagination
        const index = providers.findIndex((p) => p.id === cursor)
        if (index !== -1) {
          providers = providers.slice(index + 1, index + 1 + limit)
        }
      } else {
        // Offset-based pagination
        const startIndex = (page - 1) * limit
        providers = providers.slice(startIndex, startIndex + limit)
      }

      const hasNext =
        providers.length === limit && (cursor ? providers[providers.length - 1] !== undefined : page * limit < total)

      logger.debug(`Retrieved ${providers.length} OCR providers`, { total, page, limit })

      return {
        items: providers,
        total,
        hasNext,
        nextCursor: hasNext && providers.length > 0 ? providers[providers.length - 1].id : undefined
      }
    } catch (error) {
      logger.error('Failed to find OCR providers', error as Error)
      throw error
    }
  }

  /**
   * Create new OCR provider
   */
  async create(data: DbOcrProviderCreate, _options?: ServiceOptions): Promise<DbOcrProvider> {
    try {
      // Check if provider already exists
      const existing = await this.findById(data.id)
      if (existing) {
        throw new Error(`OCR provider ${data.id} already exists`)
      }

      const timestamp = dayjs().valueOf()
      const newProvider = {
        ...data,
        createdAt: timestamp,
        updatedAt: timestamp
      } satisfies DbOcrProvider

      // Validate data structure
      if (!isDbOcrProvider(newProvider)) {
        throw new Error('Invalid OCR provider data')
      }

      const [created] = await dbService.getDb().insert(ocrProviderTable).values(newProvider).returning()

      logger.info(`Created OCR provider: ${data.id}`)
      return created
    } catch (error) {
      logger.error(`Failed to create OCR provider ${data.id}`, error as Error)
      throw error
    }
  }

  /**
   * Update existing OCR provider
   */
  async update(id: string, data: DbOcrProviderUpdate, _options?: ServiceOptions): Promise<DbOcrProvider> {
    try {
      const existing = await this.findById(id)
      if (!existing) {
        throw new Error(`OCR provider ${id} not found`)
      }

      const newProvider = {
        ...merge({}, existing, data),
        updatedAt: dayjs().valueOf()
      } satisfies DbOcrProvider

      // Validate data structure
      if (!isDbOcrProvider(newProvider)) {
        throw new Error('Invalid OCR provider data')
      }

      const [updated] = await dbService
        .getDb()
        .update(ocrProviderTable)
        .set(newProvider)
        .where(eq(ocrProviderTable.id, id))
        .returning()

      logger.info(`Updated OCR provider: ${id}`)
      return updated
    } catch (error) {
      logger.error(`Failed to update OCR provider ${id}`, error as Error)
      throw error
    }
  }

  /**
   * Delete OCR provider
   */
  async delete(id: string, _options?: ServiceOptions): Promise<void> {
    try {
      // Check if it's a built-in provider
      if (BuiltinOcrProviderIds.some((pid) => pid === id)) {
        throw new Error('Built-in OCR providers cannot be deleted.')
      }

      // Check if provider exists
      const existing = await this.findById(id)
      if (!existing) {
        throw new Error(`OCR provider ${id} not found`)
      }

      await dbService.getDb().delete(ocrProviderTable).where(eq(ocrProviderTable.id, id))

      logger.info(`Deleted OCR provider: ${id}`)
    } catch (error) {
      logger.error(`Failed to delete OCR provider ${id}`, error as Error)
      throw error
    }
  }

  /**
   * Check if OCR provider exists
   */
  async exists(id: string, _options?: ServiceOptions): Promise<boolean> {
    try {
      const provider = await this.findById(id)
      return provider !== null
    } catch (error) {
      logger.error(`Failed to check if OCR provider ${id} exists`, error as Error)
      throw error
    }
  }

  /**
   * Replace OCR provider (full update)
   * This method is specific to OCR providers and not part of IBaseService
   */
  async replace(data: DbOcrProviderReplace): Promise<DbOcrProvider> {
    try {
      // Check if it's a built-in provider
      if (BuiltinOcrProviderIds.some((pid) => pid === data.id)) {
        throw new Error('Built-in OCR providers cannot be modified with PUT method.')
      }

      const timestamp = dayjs().valueOf()
      const existing = await this.exists(data.id)

      let newProvider: DbOcrProvider

      if (existing) {
        // Update existing
        const current = await this.findById(data.id)
        if (!current) {
          throw new Error(`OCR provider ${data.id} not found during replace operation`)
        }
        newProvider = {
          ...data,
          updatedAt: timestamp,
          createdAt: current.createdAt
        }
      } else {
        // Create new
        newProvider = {
          ...data,
          createdAt: timestamp,
          updatedAt: timestamp
        }
      }

      // Validate data structure
      if (!isDbOcrProvider(newProvider)) {
        throw new Error('Invalid OCR provider data')
      }

      const [saved] = await dbService
        .getDb()
        .insert(ocrProviderTable)
        .values(newProvider)
        .onConflictDoUpdate({
          target: ocrProviderTable.id,
          set: newProvider
        })
        .returning()

      logger.info(`Replaced OCR provider: ${data.id}`)
      return saved
    } catch (error) {
      logger.error(`Failed to replace OCR provider ${data.id}`, error as Error)
      throw error
    }
  }

  /**
   * Initialize built-in providers in database
   * This method is specific to OCR providers and not part of IBaseService
   */
  async initializeBuiltInProviders(): Promise<void> {
    try {
      // Import built-in provider configurations
      const { BUILTIN_OCR_PROVIDERS } = await import('@shared/config/ocr')

      logger.info('Initializing built-in OCR providers')

      // Check and create each built-in provider if it doesn't exist
      for (const provider of BUILTIN_OCR_PROVIDERS) {
        const exists = await this.exists(provider.id)
        if (!exists) {
          logger.info(`Creating built-in OCR provider: ${provider.id}`)
          await this.create(provider)
        } else {
          logger.debug(`Built-in OCR provider already exists: ${provider.id}`)
        }
      }

      logger.info(`Initialized ${BUILTIN_OCR_PROVIDERS.length} built-in OCR providers`)
    } catch (error) {
      logger.error('Failed to initialize built-in OCR providers', error as Error)
      throw error
    }
  }
}

// Export singleton instance
export const ocrProviderService = new OcrProviderService()
