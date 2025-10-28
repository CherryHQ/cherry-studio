import { dbService } from '@data/db/DbService'
import { ocrProviderTable } from '@data/db/schemas/ocrProvider'
import { loggerService } from '@logger'
import type {
  DbOcrProvider,
  DbOcrProviderCreate,
  DbOcrProviderReplace,
  DbOcrProviderUpdate,
  OcrProviderId
} from '@types'
import { BuiltinOcrProviderIds, isDbOcrProvider } from '@types'
import dayjs from 'dayjs'
import { eq } from 'drizzle-orm'
import { merge } from 'lodash'

const logger = loggerService.withContext('OcrProviderRepository')

/**
 * Data access layer for OCR providers
 * Handles all database operations and data validation
 *
 * TODO: This class is already functional, but the data interaction service should be
 *       migrated to src/main/data/api/services.
 *
 *       The reason why the migration hasn't been completed yet is that the data
 *       architecture is still under development, and we need to wait until the
 *       architectural design is finalized before proceeding with the migration.
 */
export class OcrProviderRepository {
  /**
   * Get all OCR providers
   */
  public async findAll(): Promise<DbOcrProvider[]> {
    try {
      const providers = await dbService.getDb().select().from(ocrProviderTable)

      return providers
    } catch (error) {
      logger.error('Failed to find all OCR providers', error as Error)
      throw error
    }
  }

  /**
   * Get OCR provider by ID
   */
  public async findById(id: OcrProviderId): Promise<DbOcrProvider> {
    try {
      const providers = await dbService
        .getDb()
        .select()
        .from(ocrProviderTable)
        .where(eq(ocrProviderTable.id, id))
        .limit(1)

      if (providers.length === 0) {
        throw new Error(`OCR provider ${id} not found`)
      }

      return providers[0]
    } catch (error) {
      logger.error(`Failed to find OCR provider ${id}`, error as Error)
      throw error
    }
  }

  /**
   * Check if provider exists
   */
  public async exists(id: OcrProviderId): Promise<boolean> {
    try {
      const providers = await dbService
        .getDb()
        .select({ id: ocrProviderTable.id })
        .from(ocrProviderTable)
        .where(eq(ocrProviderTable.id, id))
        .limit(1)

      return providers.length > 0
    } catch (error) {
      logger.error(`Failed to check if OCR provider ${id} exists`, error as Error)
      throw error
    }
  }

  /**
   * Create new OCR provider
   */
  public async create(param: DbOcrProviderCreate): Promise<DbOcrProvider> {
    try {
      // Check if provider already exists
      if (await this.exists(param.id)) {
        throw new Error(`OCR provider ${param.id} already exists`)
      }

      const timestamp = dayjs().valueOf()
      const newProvider = {
        ...param,
        createdAt: timestamp,
        updatedAt: timestamp
      } satisfies DbOcrProvider

      // Validate data structure
      if (!isDbOcrProvider(newProvider)) {
        throw new Error('Invalid OCR provider data')
      }

      const [created] = await dbService.getDb().insert(ocrProviderTable).values(newProvider).returning()

      logger.info(`Created OCR provider: ${param.id}`)
      return created
    } catch (error) {
      logger.error(`Failed to create OCR provider ${param.id}`, error as Error)
      throw error
    }
  }

  /**
   * Update OCR provider (partial update)
   */
  public async update(id: OcrProviderId, update: DbOcrProviderUpdate): Promise<DbOcrProvider> {
    try {
      const existing = await this.findById(id)

      const newProvider = {
        ...merge({}, existing, update),
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
   * Replace OCR provider (full update)
   */
  public async replace(data: DbOcrProviderReplace): Promise<DbOcrProvider> {
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
   * Delete OCR provider
   */
  public async delete(id: OcrProviderId): Promise<void> {
    try {
      // Check if it's a built-in provider
      if (BuiltinOcrProviderIds.some((pid) => pid === id)) {
        throw new Error('Built-in OCR providers cannot be deleted.')
      }

      // Check if provider exists
      await this.findById(id)

      await dbService.getDb().delete(ocrProviderTable).where(eq(ocrProviderTable.id, id))

      logger.info(`Deleted OCR provider: ${id}`)
    } catch (error) {
      logger.error(`Failed to delete OCR provider ${id}`, error as Error)
      throw error
    }
  }

  /**
   * Initialize built-in providers in database
   */
  public async initializeBuiltInProviders(): Promise<void> {
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

export const ocrProviderRepository = new OcrProviderRepository()
