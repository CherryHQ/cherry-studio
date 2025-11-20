/**
 * Preferences migrator - migrates preferences from ElectronStore and Redux to SQLite
 */

import { preferenceTable } from '@data/db/schemas/preference'
import { loggerService } from '@logger'
import { configManager } from '@main/services/ConfigManager'
import { DefaultPreferences } from '@shared/data/preference/preferenceSchemas'
import { and, eq, sql } from 'drizzle-orm'

import type { MigrationContext } from '../core/MigrationContext'
import type { ExecuteResult, PrepareResult, ValidateResult, ValidationError } from '../core/types'
import { BaseMigrator } from './BaseMigrator'
import { ELECTRON_STORE_MAPPINGS, REDUX_STORE_MAPPINGS } from './mappings/PreferencesMappings'

const logger = loggerService.withContext('PreferencesMigrator')

interface MigrationItem {
  originalKey: string
  targetKey: string
  defaultValue: unknown
  source: 'electronStore' | 'redux'
  sourceCategory?: string
}

interface PreparedData {
  targetKey: string
  value: unknown
  source: 'electronStore' | 'redux'
  originalKey: string
}

export class PreferencesMigrator extends BaseMigrator {
  readonly id = 'preferences'
  readonly name = 'Preferences'
  readonly description = 'Migrate application preferences'
  readonly order = 1

  private preparedItems: PreparedData[] = []
  private skippedCount = 0

  async prepare(ctx: MigrationContext): Promise<PrepareResult> {
    const warnings: string[] = []
    this.preparedItems = []
    this.skippedCount = 0

    try {
      // Load migration items from mappings
      const migrationItems = this.loadMigrationItems()
      logger.info(`Found ${migrationItems.length} preference items to migrate`)

      // Prepare each item
      for (const item of migrationItems) {
        try {
          let originalValue: unknown

          // Read from source
          if (item.source === 'electronStore') {
            originalValue = configManager.get(item.originalKey)
          } else if (item.source === 'redux' && item.sourceCategory) {
            originalValue = ctx.sources.reduxState.get(item.sourceCategory, item.originalKey)
          }

          // Determine value to migrate
          let valueToMigrate = originalValue
          if (originalValue === undefined || originalValue === null) {
            if (item.defaultValue !== null && item.defaultValue !== undefined) {
              valueToMigrate = item.defaultValue
            } else {
              this.skippedCount++
              continue
            }
          }

          this.preparedItems.push({
            targetKey: item.targetKey,
            value: valueToMigrate,
            source: item.source,
            originalKey: item.originalKey
          })
        } catch (error) {
          warnings.push(`Failed to prepare ${item.originalKey}: ${error}`)
        }
      }

      logger.info('Preparation completed', {
        itemCount: this.preparedItems.length,
        skipped: this.skippedCount
      })

      return {
        success: true,
        itemCount: this.preparedItems.length,
        warnings: warnings.length > 0 ? warnings : undefined
      }
    } catch (error) {
      logger.error('Preparation failed', error as Error)
      return {
        success: false,
        itemCount: 0,
        warnings: [error instanceof Error ? error.message : String(error)]
      }
    }
  }

  async execute(ctx: MigrationContext): Promise<ExecuteResult> {
    if (this.preparedItems.length === 0) {
      return { success: true, processedCount: 0 }
    }

    try {
      const db = ctx.db
      const scope = 'default'
      const timestamp = Date.now()

      // Use transaction for atomic insert
      await db.transaction(async (tx) => {
        // Batch insert all preferences
        const insertValues = this.preparedItems.map((item) => ({
          scope,
          key: item.targetKey,
          value: item.value,
          createdAt: timestamp,
          updatedAt: timestamp
        }))

        // Insert in batches to avoid SQL limitations
        const BATCH_SIZE = 100
        for (let i = 0; i < insertValues.length; i += BATCH_SIZE) {
          const batch = insertValues.slice(i, i + BATCH_SIZE)
          await tx.insert(preferenceTable).values(batch)

          // Report progress
          const progress = Math.round(((i + batch.length) / insertValues.length) * 100)
          this.reportProgress(progress, `已迁移 ${i + batch.length}/${insertValues.length} 条配置`)
        }
      })

      logger.info('Execute completed', { processedCount: this.preparedItems.length })

      return {
        success: true,
        processedCount: this.preparedItems.length
      }
    } catch (error) {
      logger.error('Execute failed', error as Error)
      return {
        success: false,
        processedCount: 0,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async validate(ctx: MigrationContext): Promise<ValidateResult> {
    const errors: ValidationError[] = []
    const db = ctx.db

    try {
      // Count validation
      const result = await db
        .select({ count: sql<number>`count(*)` })
        .from(preferenceTable)
        .where(eq(preferenceTable.scope, 'default'))
        .get()

      const targetCount = result?.count ?? 0

      // Sample validation - check critical keys
      const criticalKeys = ['app.language', 'ui.theme_mode', 'app.zoom_factor']
      for (const key of criticalKeys) {
        const record = await db
          .select()
          .from(preferenceTable)
          .where(and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, key)))
          .get()

        if (!record) {
          // Not an error if the key wasn't in source data
          const wasPrepared = this.preparedItems.some((item) => item.targetKey === key)
          if (wasPrepared) {
            errors.push({
              key,
              message: `Critical preference '${key}' not found after migration`
            })
          }
        }
      }

      return {
        success: errors.length === 0,
        errors,
        stats: {
          sourceCount: this.preparedItems.length,
          targetCount,
          skippedCount: this.skippedCount
        }
      }
    } catch (error) {
      logger.error('Validation failed', error as Error)
      return {
        success: false,
        errors: [
          {
            key: 'validation',
            message: error instanceof Error ? error.message : String(error)
          }
        ],
        stats: {
          sourceCount: this.preparedItems.length,
          targetCount: 0,
          skippedCount: this.skippedCount
        }
      }
    }
  }

  private loadMigrationItems(): MigrationItem[] {
    const items: MigrationItem[] = []

    // Process ElectronStore mappings
    for (const mapping of ELECTRON_STORE_MAPPINGS) {
      const defaultValue = DefaultPreferences.default[mapping.targetKey] ?? null
      items.push({
        originalKey: mapping.originalKey,
        targetKey: mapping.targetKey,
        defaultValue,
        source: 'electronStore'
      })
    }

    // Process Redux mappings
    for (const [category, mappings] of Object.entries(REDUX_STORE_MAPPINGS)) {
      for (const mapping of mappings) {
        const defaultValue = DefaultPreferences.default[mapping.targetKey] ?? null
        items.push({
          originalKey: mapping.originalKey,
          targetKey: mapping.targetKey,
          sourceCategory: category,
          defaultValue,
          source: 'redux'
        })
      }
    }

    return items
  }
}
