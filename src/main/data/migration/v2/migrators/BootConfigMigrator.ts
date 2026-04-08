/**
 * Boot config migrator - migrates boot configuration from legacy storage to BootConfigService
 *
 * Reads from ElectronStore, Redux, Dexie settings, localStorage, and the legacy
 * home config file (~/.cherrystudio/config/config.json) sources, then writes
 * values to bootConfigService (~/.cherrystudio/boot-config.json).
 */

import { loggerService } from '@logger'
import { bootConfigService } from '@main/data/bootConfig'
import { DefaultBootConfig } from '@shared/data/bootConfig/bootConfigSchemas'
import type { BootConfigKey } from '@shared/data/bootConfig/bootConfigTypes'
import type { ExecuteResult, PrepareResult, ValidateResult, ValidationError } from '@shared/data/migration/v2/types'

import type { MigrationContext } from '../core/MigrationContext'
import { BaseMigrator } from './BaseMigrator'
import {
  BOOT_CONFIG_DEXIE_SETTINGS_MAPPINGS,
  BOOT_CONFIG_ELECTRON_STORE_MAPPINGS,
  BOOT_CONFIG_LOCALSTORAGE_MAPPINGS,
  BOOT_CONFIG_REDUX_MAPPINGS
} from './mappings/BootConfigMappings'

const logger = loggerService.withContext('BootConfigMigrator')

type MigrationSource = 'electronStore' | 'redux' | 'dexie-settings' | 'localStorage' | 'configfile'

interface MigrationItem {
  originalKey: string
  targetKey: BootConfigKey
  defaultValue: unknown
  source: MigrationSource
  sourceCategory?: string
}

interface PreparedData {
  targetKey: BootConfigKey
  value: unknown
  source: MigrationSource
  originalKey: string
}

export class BootConfigMigrator extends BaseMigrator {
  readonly id = 'bootConfig'
  readonly name = 'Boot Config'
  readonly description = 'Migrate boot configuration from legacy storage'
  readonly order = 0.5

  private preparedItems: PreparedData[] = []
  private skippedCount = 0

  override reset(): void {
    this.preparedItems = []
    this.skippedCount = 0
  }

  async prepare(ctx: MigrationContext): Promise<PrepareResult> {
    const warnings: string[] = []

    try {
      const migrationItems = this.loadMigrationItems()
      logger.info(`Found ${migrationItems.length} boot config items to migrate`)

      for (const item of migrationItems) {
        try {
          let originalValue: unknown

          // Read from source
          if (item.source === 'electronStore') {
            originalValue = ctx.sources.electronStore.get(item.originalKey)
          } else if (item.source === 'redux' && item.sourceCategory) {
            originalValue = ctx.sources.reduxState.get(item.sourceCategory, item.originalKey)
          } else if (item.source === 'dexie-settings') {
            originalValue = ctx.sources.dexieSettings.get(item.originalKey)
          } else if (item.source === 'localStorage') {
            originalValue = ctx.sources.localStorage.get(item.originalKey)
          } else if (item.source === 'configfile') {
            // Reader returns Record<string, string> | null. `null` flows into
            // the shared null-skip guard below, matching the other sources'
            // "no data → skip" semantics without a special branch.
            originalValue = ctx.sources.legacyHomeConfig.getUserDataPath()
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

  async execute(): Promise<ExecuteResult> {
    if (this.preparedItems.length === 0) {
      return { success: true, processedCount: 0 }
    }

    try {
      let processedCount = 0

      for (const item of this.preparedItems) {
        bootConfigService.set(item.targetKey, item.value as never)
        processedCount++

        const progress = Math.round((processedCount / this.preparedItems.length) * 100)
        this.reportProgress(progress, `Migrated ${processedCount}/${this.preparedItems.length} boot config items`, {
          key: 'migration.progress.migrated_boot_config',
          params: { processed: processedCount, total: this.preparedItems.length }
        })
      }

      // Flush to ensure all values are persisted to boot-config.json
      bootConfigService.flush()

      logger.info('Execute completed', { processedCount })

      return {
        success: true,
        processedCount
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

  async validate(): Promise<ValidateResult> {
    const errors: ValidationError[] = []

    try {
      let targetCount = 0

      for (const item of this.preparedItems) {
        const value = bootConfigService.get(item.targetKey)

        if (value === undefined) {
          errors.push({
            key: item.targetKey,
            message: `Boot config key '${item.targetKey}' not found after migration`
          })
        } else {
          targetCount++
        }
      }

      logger.info('Validation completed', {
        sourceCount: this.preparedItems.length,
        targetCount,
        skippedCount: this.skippedCount
      })

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
    for (const mapping of BOOT_CONFIG_ELECTRON_STORE_MAPPINGS) {
      const defaultValue = DefaultBootConfig[mapping.targetKey] ?? null
      items.push({
        originalKey: mapping.originalKey,
        targetKey: mapping.targetKey,
        defaultValue,
        source: 'electronStore'
      })
    }

    // Process Redux mappings
    for (const [category, mappings] of Object.entries(BOOT_CONFIG_REDUX_MAPPINGS)) {
      for (const mapping of mappings) {
        const defaultValue = DefaultBootConfig[mapping.targetKey] ?? null
        items.push({
          originalKey: mapping.originalKey,
          targetKey: mapping.targetKey,
          sourceCategory: category,
          defaultValue,
          source: 'redux'
        })
      }
    }

    // Process Dexie settings mappings
    for (const mapping of BOOT_CONFIG_DEXIE_SETTINGS_MAPPINGS) {
      const defaultValue = DefaultBootConfig[mapping.targetKey] ?? null
      items.push({
        originalKey: mapping.originalKey,
        targetKey: mapping.targetKey,
        defaultValue,
        source: 'dexie-settings'
      })
    }

    // Process localStorage mappings
    for (const mapping of BOOT_CONFIG_LOCALSTORAGE_MAPPINGS) {
      const defaultValue = DefaultBootConfig[mapping.targetKey] ?? null
      items.push({
        originalKey: mapping.originalKey,
        targetKey: mapping.targetKey,
        defaultValue,
        source: 'localStorage'
      })
    }

    // Config-file source mappings — manually maintained, not auto-generated.
    // The `targetKey: BootConfigKey` type annotation is the regen safety net:
    // if the schema loses 'app.user_data_path', this array literal fails to
    // compile at its declaration site (loud failure, not silent drift).
    //
    // Config-file items intentionally use `defaultValue: null` rather than
    // the schema default. The other sources fall back to DefaultBootConfig on
    // a missing source value to ensure the key exists with a sane default —
    // but for config-file data like `app.user_data_path`, "no v1 file" means
    // "nothing to migrate", and writing the schema default `{}` would be a
    // spurious migration. Null here flows into the shared null-skip guard in
    // prepare(), matching the reader's `null` return semantics.
    const configFileMappings: ReadonlyArray<{ originalKey: string; targetKey: BootConfigKey }> = [
      {
        // `appDataPath` field at the top level of ~/.cherrystudio/config/config.json
        // (legacy string or array of { executablePath, dataPath })
        originalKey: 'appDataPath',
        targetKey: 'app.user_data_path'
      }
    ]
    for (const mapping of configFileMappings) {
      items.push({
        originalKey: mapping.originalKey,
        targetKey: mapping.targetKey,
        defaultValue: null,
        source: 'configfile'
      })
    }

    return items
  }
}
