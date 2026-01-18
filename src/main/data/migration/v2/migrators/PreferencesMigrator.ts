/**
 * Preferences migrator - migrates preferences from ElectronStore and Redux to SQLite
 */

import { preferenceTable } from '@data/db/schemas/preference'
import { loggerService } from '@logger'
import { configManager } from '@main/services/ConfigManager'
import type { ExecuteResult, PrepareResult, ValidateResult, ValidationError } from '@shared/data/migration/v2/types'
import { DefaultPreferences } from '@shared/data/preference/preferenceSchemas'
import { and, eq, sql } from 'drizzle-orm'

import type { MigrationContext } from '../core/MigrationContext'
import { BaseMigrator } from './BaseMigrator'
import { COMPLEX_PREFERENCE_MAPPINGS, getComplexMappingTargetKeys } from './mappings/ComplexPreferenceMappings'
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
  source: 'electronStore' | 'redux' | 'complex'
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
      // Step 1: Detect conflicts between simple and complex mappings (strict mode)
      const simpleTargetKeys = this.getSimpleMappingTargetKeys()
      const complexTargetKeys = getComplexMappingTargetKeys()

      const conflicts = simpleTargetKeys.filter((k) => complexTargetKeys.includes(k))
      if (conflicts.length > 0) {
        const errorMessage =
          `Mapping conflicts detected! The following keys exist in both simple and complex mappings:\n` +
          conflicts.map((k) => `  - ${k}`).join('\n') +
          `\n\nPlease remove these keys from simple mappings (PreferencesMappings.ts) ` +
          `since they are handled by complex mappings.`
        logger.error('Mapping conflicts detected', { conflicts })
        throw new Error(errorMessage)
      }

      // Step 2: Process simple mappings
      const migrationItems = this.loadMigrationItems()
      logger.info(`Found ${migrationItems.length} simple preference items to migrate`)

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

      // Step 3: Process complex mappings
      if (COMPLEX_PREFERENCE_MAPPINGS.length > 0) {
        logger.info(`Processing ${COMPLEX_PREFERENCE_MAPPINGS.length} complex preference mappings`)

        for (const mapping of COMPLEX_PREFERENCE_MAPPINGS) {
          try {
            // Collect all source values
            const sourceValues: Record<string, unknown> = {}
            for (const [name, def] of Object.entries(mapping.sources)) {
              if (def.source === 'electronStore') {
                sourceValues[name] = configManager.get(def.key)
              } else if (def.source === 'redux' && def.category) {
                sourceValues[name] = ctx.sources.reduxState.get(def.category, def.key)
              }
            }

            // Execute transformation
            const results = mapping.transform(sourceValues)

            // Add results to preparedItems
            for (const [targetKey, value] of Object.entries(results)) {
              if (value !== undefined) {
                this.preparedItems.push({
                  targetKey,
                  value,
                  source: 'complex',
                  originalKey: mapping.id
                })
              }
            }

            logger.debug(`Complex mapping '${mapping.id}' produced ${Object.keys(results).length} keys`)
          } catch (error) {
            warnings.push(`Failed to process complex mapping '${mapping.id}': ${error}`)
            logger.warn(`Complex mapping '${mapping.id}' failed`, error as Error)
          }
        }
      }

      logger.info('Preparation completed', {
        itemCount: this.preparedItems.length,
        skipped: this.skippedCount,
        simpleMappings: migrationItems.length,
        complexMappings: COMPLEX_PREFERENCE_MAPPINGS.length
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

  /**
   * Get all target keys from simple mappings (for conflict detection)
   */
  private getSimpleMappingTargetKeys(): string[] {
    const keys: string[] = []

    // Collect from ElectronStore mappings
    for (const mapping of ELECTRON_STORE_MAPPINGS) {
      keys.push(mapping.targetKey)
    }

    // Collect from Redux mappings
    for (const mappings of Object.values(REDUX_STORE_MAPPINGS)) {
      for (const mapping of mappings) {
        keys.push(mapping.targetKey)
      }
    }

    return keys
  }
}
