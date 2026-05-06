/**
 * MiniApp migrator - migrates miniapp configurations from Redux to SQLite
 */

import type { MiniAppInsert, MiniAppStatus } from '@data/db/schemas/miniapp'
import { miniAppTable } from '@data/db/schemas/miniapp'
import { loggerService } from '@logger'
import type { ExecuteResult, PrepareResult, ValidateResult } from '@shared/data/migration/v2/types'
import { sql } from 'drizzle-orm'

import type { MigrationContext } from '../core/MigrationContext'
import { assignOrderKeysByScope } from '../utils/orderKey'
import { BaseMigrator } from './BaseMigrator'
import { transformMiniApp } from './mappings/MiniAppMappings'

type MiniAppRowWithoutOrderKey = Omit<MiniAppInsert, 'orderKey'>

const logger = loggerService.withContext('MiniAppMigrator')

export class MiniAppMigrator extends BaseMigrator {
  readonly id = 'miniapp'
  readonly name = 'MiniApp'
  readonly description = 'Migrate miniapp configurations from Redux to SQLite'
  readonly order = 1.2

  private preparedRows: MiniAppInsert[] = []
  private skippedCount = 0
  private originalSourceCount = 0

  override reset(): void {
    this.preparedRows = []
    this.skippedCount = 0
    this.originalSourceCount = 0
  }

  async prepare(ctx: MigrationContext): Promise<PrepareResult> {
    this.preparedRows = []
    this.skippedCount = 0
    this.originalSourceCount = 0

    try {
      const warnings: string[] = []
      const state = ctx.sources.reduxState.getCategory<{
        enabled?: Record<string, unknown>[]
        disabled?: Record<string, unknown>[]
        pinned?: Record<string, unknown>[]
      }>('minapps')

      if (!state) {
        logger.info('No miniapps state found, skipping migration')
        return { success: true, itemCount: 0 }
      }

      // Process each status group
      const groups: { data: Record<string, unknown>[]; status: MiniAppStatus }[] = [
        { data: state.enabled ?? [], status: 'enabled' },
        { data: state.disabled ?? [], status: 'disabled' },
        { data: state.pinned ?? [], status: 'pinned' }
      ]

      // Calculate original source count (total apps before filtering/deduplication)
      this.originalSourceCount = groups.reduce((total, group) => total + group.data.length, 0)

      // Track seen IDs to detect duplicates across groups
      // A pinned app also appears in enabled — prefer the pinned status (higher priority)
      const seenIds = new Map<string, MiniAppRowWithoutOrderKey>()

      // Process pinned first (highest priority), then enabled, then disabled
      const priorityOrder: MiniAppStatus[] = ['pinned', 'enabled', 'disabled']

      for (const status of priorityOrder) {
        const group = groups.find((g) => g.status === status)
        if (!group) continue

        for (const app of group.data) {
          if (!app || !app.id || typeof app.id !== 'string') {
            this.skippedCount++
            warnings.push(`Skipped ${status} app without valid id: ${app?.name ?? 'unknown'}`)
            continue
          }

          try {
            const row = transformMiniApp(app, status)

            // All rows must have name and url populated (full data + delta tracking).
            if (!row.name || !row.url) {
              this.skippedCount++
              warnings.push(`Skipped ${status} app ${app.id}: missing name or url`)
              continue
            }

            // If already seen with same or higher priority, keep existing
            // If seen with lower priority, replace (e.g. enabled -> pinned)
            const existing = seenIds.get(app.id)
            if (!existing) {
              seenIds.set(app.id, row)
            }
            // else: keep the higher-priority version already stored
          } catch (err) {
            this.skippedCount++
            const errMsg = err instanceof Error ? err.message : String(err)
            warnings.push(`Failed to transform ${status} app ${app.id}: ${errMsg}`)
            logger.warn(`Skipping ${status} app ${app.id}`, err instanceof Error ? err : new Error(errMsg))
          }
        }
      }

      // Stamp orderKey within each status partition (data-ordering-guide.md §5)
      const rowsWithoutOrder: MiniAppRowWithoutOrderKey[] = [...seenIds.values()]
      this.preparedRows = assignOrderKeysByScope(rowsWithoutOrder, (row) => row.status ?? 'enabled') as MiniAppInsert[]

      const byStatus = {
        enabled: this.preparedRows.filter((r) => r.status === 'enabled').length,
        disabled: this.preparedRows.filter((r) => r.status === 'disabled').length,
        pinned: this.preparedRows.filter((r) => r.status === 'pinned').length
      }

      logger.info('Preparation completed', {
        appCount: this.preparedRows.length,
        skipped: this.skippedCount,
        byStatus
      })

      return {
        success: true,
        itemCount: this.preparedRows.length,
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
    if (this.preparedRows.length === 0) {
      return { success: true, processedCount: 0 }
    }

    try {
      let processed = 0

      const BATCH_SIZE = 100
      await ctx.db.transaction(async (tx) => {
        for (let i = 0; i < this.preparedRows.length; i += BATCH_SIZE) {
          const batch = this.preparedRows.slice(i, i + BATCH_SIZE)
          await tx.insert(miniAppTable).values(batch)
          processed += batch.length
        }
      })

      this.reportProgress(100, `Migrated ${processed} miniapps`, {
        key: 'migration.progress.migrated_miniapps',
        params: { processed, total: this.preparedRows.length }
      })

      logger.info('Execute completed', { processedCount: processed })

      return { success: true, processedCount: processed }
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
    try {
      const result = await ctx.db.select({ count: sql<number>`count(*)` }).from(miniAppTable).get()
      const appCount = result?.count ?? 0
      const errors: { key: string; message: string }[] = []

      if (appCount !== this.preparedRows.length) {
        errors.push({
          key: 'count_mismatch',
          message: `Expected ${this.preparedRows.length} miniapps but found ${appCount}`
        })
      }

      // All rows must have non-empty appId, name, and url.
      const badRows = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(miniAppTable)
        .where(sql`${miniAppTable.appId} = '' OR ${miniAppTable.name} = '' OR ${miniAppTable.url} = ''`)
        .get()
      const badCount = badRows?.count ?? 0
      if (badCount > 0) {
        errors.push({
          key: 'empty_fields',
          message: `Found ${badCount} rows with empty appId, name, or url`
        })
      }

      return {
        success: errors.length === 0,
        errors,
        stats: {
          sourceCount: this.originalSourceCount,
          targetCount: appCount,
          skippedCount: this.skippedCount
        }
      }
    } catch (error) {
      logger.error('Validation failed', error as Error)
      return {
        success: false,
        errors: [{ key: 'validation', message: error instanceof Error ? error.message : String(error) }],
        stats: {
          sourceCount: this.originalSourceCount,
          targetCount: 0,
          skippedCount: this.skippedCount
        }
      }
    }
  }
}
