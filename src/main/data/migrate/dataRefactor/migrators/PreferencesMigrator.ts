import { dbService } from '@data/db/DbService'
import { preferenceTable } from '@data/db/schemas/preference'
import { loggerService } from '@logger'
import { DefaultPreferences } from '@shared/data/preference/preferenceSchemas'
import { and, eq } from 'drizzle-orm'

import { configManager } from '../../../../services/ConfigManager'
import { DataRefactorMigrateService } from '../DataRefactorMigrateService'
import { ELECTRON_STORE_MAPPINGS, REDUX_STORE_MAPPINGS } from './PreferencesMappings'

const logger = loggerService.withContext('PreferencesMigrator')

export interface MigrationItem {
  originalKey: string
  targetKey: string
  type: string
  defaultValue: any
  source: 'electronStore' | 'redux'
  sourceCategory?: string // Optional for electronStore
}

export interface MigrationResult {
  success: boolean
  migratedCount: number
  errors: Array<{
    key: string
    error: string
  }>
}

export interface PreparedMigrationData {
  targetKey: string
  value: any
  source: 'electronStore' | 'redux'
  originalKey: string
  sourceCategory?: string
}

export interface BatchMigrationResult {
  newPreferences: PreparedMigrationData[]
  updatedPreferences: PreparedMigrationData[]
  skippedCount: number
  preparationErrors: Array<{
    key: string
    error: string
  }>
}

export class PreferencesMigrator {
  private db = dbService.getDb()
  private migrateService: DataRefactorMigrateService

  constructor(migrateService: DataRefactorMigrateService) {
    this.migrateService = migrateService
  }

  /**
   * Execute preferences migration from all sources using batch operations and transactions
   */
  async migrate(onProgress?: (progress: number, message: string) => void): Promise<MigrationResult> {
    logger.info('Starting preferences migration with batch operations')

    const result: MigrationResult = {
      success: true,
      migratedCount: 0,
      errors: []
    }

    try {
      // Phase 1: Prepare all migration data in memory (50% of progress)
      onProgress?.(10, 'Loading migration items...')
      const migrationItems = await this.loadMigrationItems()
      logger.info(`Found ${migrationItems.length} items to migrate`)

      onProgress?.(25, 'Preparing migration data...')
      const batchResult = await this.prepareMigrationData(migrationItems, (progress) => {
        // Map preparation progress to 25-50% of total progress
        const totalProgress = 25 + Math.floor(progress * 0.25)
        onProgress?.(totalProgress, 'Preparing migration data...')
      })

      // Add preparation errors to result
      result.errors.push(...batchResult.preparationErrors)

      if (batchResult.preparationErrors.length > 0) {
        logger.warn('Some items failed during preparation', {
          errorCount: batchResult.preparationErrors.length
        })
      }

      // Phase 2: Execute batch migration in transaction (50% of progress)
      onProgress?.(50, 'Executing batch migration...')

      const totalOperations = batchResult.newPreferences.length + batchResult.updatedPreferences.length
      if (totalOperations > 0) {
        try {
          await this.executeBatchMigration(batchResult, (progress) => {
            // Map execution progress to 50-90% of total progress
            const totalProgress = 50 + Math.floor(progress * 0.4)
            onProgress?.(totalProgress, 'Executing batch migration...')
          })

          result.migratedCount = totalOperations
          logger.info('Batch migration completed successfully', {
            newPreferences: batchResult.newPreferences.length,
            updatedPreferences: batchResult.updatedPreferences.length,
            skippedCount: batchResult.skippedCount
          })
        } catch (batchError) {
          logger.error('Batch migration transaction failed - all changes rolled back', batchError as Error)
          result.success = false
          result.errors.push({
            key: 'batch_migration',
            error: `Transaction failed: ${batchError instanceof Error ? batchError.message : String(batchError)}`
          })
          // Note: No need to manually rollback - transaction handles this automatically
        }
      } else {
        logger.info('No preferences to migrate')
      }

      onProgress?.(100, 'Migration completed')

      // Set success based on whether we had any critical errors
      result.success = result.errors.length === 0

      logger.info('Preferences migration completed', {
        migratedCount: result.migratedCount,
        errorCount: result.errors.length,
        skippedCount: batchResult.skippedCount
      })
    } catch (error) {
      logger.error('Preferences migration failed', error as Error)
      result.success = false
      result.errors.push({
        key: 'global',
        error: error instanceof Error ? error.message : String(error)
      })
    }

    return result
  }

  /**
   * Load migration items from generated mapping relationships
   * This uses the auto-generated PreferencesMappings.ts file
   */
  private async loadMigrationItems(): Promise<MigrationItem[]> {
    logger.info('Loading migration items from generated mappings')
    const items: MigrationItem[] = []

    // Process ElectronStore mappings - no sourceCategory needed
    ELECTRON_STORE_MAPPINGS.forEach((mapping) => {
      const defaultValue = DefaultPreferences.default[mapping.targetKey] ?? null
      items.push({
        originalKey: mapping.originalKey,
        targetKey: mapping.targetKey,
        type: 'unknown', // Type will be inferred from defaultValue during conversion
        defaultValue,
        source: 'electronStore'
      })
    })

    // Process Redux mappings
    Object.entries(REDUX_STORE_MAPPINGS).forEach(([category, mappings]) => {
      mappings.forEach((mapping) => {
        const defaultValue = DefaultPreferences.default[mapping.targetKey] ?? null
        items.push({
          originalKey: mapping.originalKey, // May contain nested paths like "codeEditor.enabled"
          targetKey: mapping.targetKey,
          sourceCategory: category,
          type: 'unknown', // Type will be inferred from defaultValue during conversion
          defaultValue,
          source: 'redux'
        })
      })
    })

    logger.info('Successfully loaded migration items from generated mappings', {
      totalItems: items.length,
      electronStoreItems: items.filter((i) => i.source === 'electronStore').length,
      reduxItems: items.filter((i) => i.source === 'redux').length
    })

    return items
  }

  /**
   * Prepare all migration data in memory before database operations
   * This phase reads all source data and performs conversions/validations
   */
  private async prepareMigrationData(
    migrationItems: MigrationItem[],
    onProgress?: (progress: number) => void
  ): Promise<BatchMigrationResult> {
    logger.info('Starting migration data preparation', { itemCount: migrationItems.length })

    const batchResult: BatchMigrationResult = {
      newPreferences: [],
      updatedPreferences: [],
      skippedCount: 0,
      preparationErrors: []
    }

    // Get existing preferences to determine which are new vs updated
    const existingPreferences = await this.getExistingPreferences()
    const existingKeys = new Set(existingPreferences.map((p) => p.key))

    // Process each migration item
    for (let i = 0; i < migrationItems.length; i++) {
      const item = migrationItems[i]

      try {
        // Read original value from source
        let originalValue: any
        if (item.source === 'electronStore') {
          originalValue = await this.readFromElectronStore(item.originalKey)
        } else if (item.source === 'redux') {
          if (!item.sourceCategory) {
            throw new Error(`Redux source requires sourceCategory for item: ${item.originalKey}`)
          }
          originalValue = await this.readFromReduxPersist(item.sourceCategory, item.originalKey)
        } else {
          throw new Error(`Unknown source: ${item.source}`)
        }

        // Determine value to migrate
        let valueToMigrate = originalValue
        let shouldSkip = false

        if (originalValue === undefined || originalValue === null) {
          if (item.defaultValue !== null && item.defaultValue !== undefined) {
            valueToMigrate = item.defaultValue
            logger.debug('Using default value for preparation', {
              targetKey: item.targetKey,
              source: item.source,
              originalKey: item.originalKey
            })
          } else {
            shouldSkip = true
            batchResult.skippedCount++
            logger.debug('Skipping item - no data and no meaningful default', {
              targetKey: item.targetKey,
              source: item.source,
              originalKey: item.originalKey
            })
          }
        }

        if (!shouldSkip) {
          // Convert value to appropriate type
          const convertedValue = this.convertValue(valueToMigrate, item.type)

          // Create prepared migration data
          const preparedData: PreparedMigrationData = {
            targetKey: item.targetKey,
            value: convertedValue,
            source: item.source,
            originalKey: item.originalKey,
            sourceCategory: item.sourceCategory
          }

          // Categorize as new or updated
          if (existingKeys.has(item.targetKey)) {
            batchResult.updatedPreferences.push(preparedData)
          } else {
            batchResult.newPreferences.push(preparedData)
          }

          logger.debug('Prepared migration data', {
            targetKey: item.targetKey,
            isUpdate: existingKeys.has(item.targetKey),
            source: item.source
          })
        }
      } catch (error) {
        logger.error('Failed to prepare migration item', { item, error })
        batchResult.preparationErrors.push({
          key: item.originalKey,
          error: error instanceof Error ? error.message : String(error)
        })
      }

      // Report progress
      const progress = Math.floor(((i + 1) / migrationItems.length) * 100)
      onProgress?.(progress)
    }

    logger.info('Migration data preparation completed', {
      newPreferences: batchResult.newPreferences.length,
      updatedPreferences: batchResult.updatedPreferences.length,
      skippedCount: batchResult.skippedCount,
      errorCount: batchResult.preparationErrors.length
    })

    return batchResult
  }

  /**
   * Get all existing preferences from database to determine new vs updated items
   */
  private async getExistingPreferences(): Promise<Array<{ key: string; value: any }>> {
    try {
      const preferences = await this.db
        .select({
          key: preferenceTable.key,
          value: preferenceTable.value
        })
        .from(preferenceTable)
        .where(eq(preferenceTable.scope, 'default'))

      logger.debug('Loaded existing preferences', { count: preferences.length })
      return preferences
    } catch (error) {
      logger.error('Failed to load existing preferences', error as Error)
      return []
    }
  }

  /**
   * Execute batch migration using database transaction with bulk operations
   */
  private async executeBatchMigration(
    batchData: BatchMigrationResult,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    logger.info('Starting batch migration execution', {
      newCount: batchData.newPreferences.length,
      updateCount: batchData.updatedPreferences.length
    })

    // Validate batch data before starting transaction
    this.validateBatchData(batchData)

    await this.db.transaction(async (tx) => {
      const scope = 'default'
      const timestamp = Date.now()
      let completedOperations = 0
      const totalOperations = batchData.newPreferences.length + batchData.updatedPreferences.length

      // Batch insert new preferences
      if (batchData.newPreferences.length > 0) {
        logger.debug('Executing batch insert for new preferences', { count: batchData.newPreferences.length })

        const insertValues = batchData.newPreferences.map((item) => ({
          scope,
          key: item.targetKey,
          value: item.value,
          createdAt: timestamp,
          updatedAt: timestamp
        }))

        await tx.insert(preferenceTable).values(insertValues)

        completedOperations += batchData.newPreferences.length
        const progress = Math.floor((completedOperations / totalOperations) * 100)
        onProgress?.(progress)

        logger.info('Batch insert completed', { insertedCount: batchData.newPreferences.length })
      }

      // Batch update existing preferences
      if (batchData.updatedPreferences.length > 0) {
        logger.debug('Executing batch updates for existing preferences', { count: batchData.updatedPreferences.length })

        // Execute updates in batches to avoid SQL limitations
        const BATCH_SIZE = 50
        const updateBatches = this.chunkArray(batchData.updatedPreferences, BATCH_SIZE)

        for (const batch of updateBatches) {
          // Use Promise.all to execute updates in parallel within the transaction
          await Promise.all(
            batch.map((item) =>
              tx
                .update(preferenceTable)
                .set({
                  value: item.value,
                  updatedAt: timestamp
                })
                .where(and(eq(preferenceTable.scope, scope), eq(preferenceTable.key, item.targetKey)))
            )
          )

          completedOperations += batch.length
          const progress = Math.floor((completedOperations / totalOperations) * 100)
          onProgress?.(progress)
        }

        logger.info('Batch updates completed', { updatedCount: batchData.updatedPreferences.length })
      }

      logger.info('Transaction completed successfully', {
        totalOperations: completedOperations,
        newPreferences: batchData.newPreferences.length,
        updatedPreferences: batchData.updatedPreferences.length
      })
    })
  }

  /**
   * Validate batch data before executing migration
   */
  private validateBatchData(batchData: BatchMigrationResult): void {
    const allData = [...batchData.newPreferences, ...batchData.updatedPreferences]

    // Check for duplicate target keys
    const targetKeys = allData.map((item) => item.targetKey)
    const duplicateKeys = targetKeys.filter((key, index) => targetKeys.indexOf(key) !== index)

    if (duplicateKeys.length > 0) {
      throw new Error(`Duplicate target keys found in migration data: ${duplicateKeys.join(', ')}`)
    }

    // Validate each item has required fields
    for (const item of allData) {
      if (!item.targetKey || item.targetKey.trim() === '') {
        throw new Error(`Invalid targetKey found: '${item.targetKey}'`)
      }

      if (item.value === undefined) {
        throw new Error(`Undefined value for targetKey: '${item.targetKey}'`)
      }
    }

    logger.debug('Batch data validation passed', {
      totalItems: allData.length,
      uniqueKeys: targetKeys.length
    })
  }

  /**
   * Split array into chunks of specified size for batch processing
   */
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = []
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize))
    }
    return chunks
  }

  /**
   * Read value from ElectronStore (via ConfigManager)
   */
  private async readFromElectronStore(key: string): Promise<any> {
    try {
      return configManager.get(key)
    } catch (error) {
      logger.warn('Failed to read from ElectronStore', { key, error })
      return undefined
    }
  }

  /**
   * Read value from Redux persist data with support for nested paths
   */
  private async readFromReduxPersist(category: string, key: string): Promise<any> {
    try {
      // Get cached Redux data from migrate service
      const reduxData = this.migrateService?.getReduxData()

      if (!reduxData) {
        logger.warn('No Redux persist data available in cache', { category, key })
        return undefined
      }

      logger.debug('Reading from cached Redux persist data', {
        category,
        key,
        availableCategories: Object.keys(reduxData),
        isNestedKey: key.includes('.')
      })

      // Get the category data from Redux persist cache
      const categoryData = reduxData[category]
      if (!categoryData) {
        logger.debug('Category not found in Redux persist data', {
          category,
          availableCategories: Object.keys(reduxData)
        })
        return undefined
      }

      // Redux persist usually stores data as JSON strings
      let parsedCategoryData
      try {
        parsedCategoryData = typeof categoryData === 'string' ? JSON.parse(categoryData) : categoryData
      } catch (parseError) {
        logger.warn('Failed to parse Redux persist category data', {
          category,
          categoryData: typeof categoryData,
          parseError
        })
        return undefined
      }

      // Handle nested paths (e.g., "codeEditor.enabled")
      let value
      if (key.includes('.')) {
        // Parse nested path
        const keyPath = key.split('.')
        let current = parsedCategoryData

        logger.debug('Parsing nested key path', {
          category,
          key,
          keyPath,
          rootDataKeys: current ? Object.keys(current) : []
        })

        for (const pathSegment of keyPath) {
          if (current && typeof current === 'object' && !Array.isArray(current)) {
            current = current[pathSegment]
            logger.debug('Navigated to path segment', {
              pathSegment,
              foundValue: current !== undefined,
              valueType: typeof current
            })
          } else {
            logger.debug('Failed to navigate nested path - invalid structure', {
              pathSegment,
              currentType: typeof current,
              isArray: Array.isArray(current)
            })
            return undefined
          }
        }
        value = current
      } else {
        // Direct field access (e.g., "theme")
        value = parsedCategoryData[key]
      }

      if (value !== undefined) {
        logger.debug('Successfully read from Redux persist cache', {
          category,
          key,
          value,
          valueType: typeof value,
          isNested: key.includes('.')
        })
      } else {
        logger.debug('Key not found in Redux persist data', {
          category,
          key,
          availableKeys: parsedCategoryData ? Object.keys(parsedCategoryData) : []
        })
      }

      return value
    } catch (error) {
      logger.warn('Failed to read from Redux persist cache', { category, key, error })
      return undefined
    }
  }

  /**
   * Convert value to the specified type
   */
  private convertValue(value: any, targetType: string): any {
    if (value === null || value === undefined) {
      return null
    }

    try {
      switch (targetType) {
        case 'boolean':
          return this.toBoolean(value)
        case 'string':
          return this.toString(value)
        case 'number':
          return this.toNumber(value)
        case 'array':
        case 'unknown[]':
          return this.toArray(value)
        case 'object':
        case 'Record<string, unknown>':
          return this.toObject(value)
        default:
          return value
      }
    } catch (error) {
      logger.warn('Type conversion failed, using original value', { value, targetType, error })
      return value
    }
  }

  private toBoolean(value: any): boolean {
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') {
      const lower = value.toLowerCase()
      return lower === 'true' || lower === '1' || lower === 'yes'
    }
    if (typeof value === 'number') return value !== 0
    return Boolean(value)
  }

  private toString(value: any): string {
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  }

  private toNumber(value: any): number {
    if (typeof value === 'number') return value
    if (typeof value === 'string') {
      const parsed = parseFloat(value)
      return isNaN(parsed) ? 0 : parsed
    }
    if (typeof value === 'boolean') return value ? 1 : 0
    return 0
  }

  private toArray(value: any): any[] {
    if (Array.isArray(value)) return value
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value)
        return Array.isArray(parsed) ? parsed : [value]
      } catch {
        return [value]
      }
    }
    return [value]
  }

  private toObject(value: any): Record<string, any> {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value
    }
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value)
        return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : { value }
      } catch {
        return { value }
      }
    }
    return { value }
  }
}
