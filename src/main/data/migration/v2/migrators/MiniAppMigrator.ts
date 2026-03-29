/**
 * MiniApp migrator - migrates miniapp configurations from Redux to SQLite
 */

import type { InsertMiniAppRow, MiniAppStatus } from '@data/db/schemas/miniapp'
import { miniappTable } from '@data/db/schemas/miniapp'
import { loggerService } from '@logger'
import type { ExecuteResult, PrepareResult, ValidateResult } from '@shared/data/migration/v2/types'
import { sql } from 'drizzle-orm'

import type { MigrationContext } from '../core/MigrationContext'
import { BaseMigrator } from './BaseMigrator'
import { transformMiniApp } from './mappings/MiniAppMappings'

const logger = loggerService.withContext('MiniAppMigrator')

export class MiniAppMigrator extends BaseMigrator {
  readonly id = 'miniapp'
  readonly name = 'MiniApp'
  readonly description = 'Migrate miniapp configurations from Redux to SQLite'
  readonly order = 1.2

  private preparedRows: InsertMiniAppRow[] = []
  private skippedCount = 0

  async prepare(ctx: MigrationContext): Promise<PrepareResult> {
    this.preparedRows = []
    this.skippedCount = 0

    try {
      const warnings: string[] = []
      const state = ctx.sources.reduxState.getCategory<{
        enabled?: Record<string, unknown>[]
        disabled?: Record<string, unknown>[]
        pinned?: Record<string, unknown>[]
      }>('minapps')

      if (!state) {
        logger.info('No minapps state found, skipping migration')
        return { success: true, itemCount: 0 }
      }

      // Process each status group
      const groups: { data: Record<string, unknown>[]; status: MiniAppStatus }[] = [
        { data: state.enabled ?? [], status: 'enabled' },
        { data: state.disabled ?? [], status: 'disabled' },
        { data: state.pinned ?? [], status: 'pinned' }
      ]

      // Track seen IDs to detect duplicates across groups
      // A pinned app also appears in enabled — prefer the pinned status (higher priority)
      const seenIds = new Map<string, InsertMiniAppRow>()

      // Process pinned first (highest priority), then enabled, then disabled
      const priorityOrder: MiniAppStatus[] = ['pinned', 'enabled', 'disabled']

      for (const status of priorityOrder) {
        const group = groups.find((g) => g.status === status)
        if (!group) continue

        for (let i = 0; i < group.data.length; i++) {
          const app = group.data[i]

          if (!app || !app.id || typeof app.id !== 'string') {
            this.skippedCount++
            warnings.push(`Skipped ${status} app without valid id: ${app?.name ?? 'unknown'}`)
            continue
          }

          try {
            const row = transformMiniApp(app, status, i)

            // If already seen with same or higher priority, keep existing
            // If seen with lower priority, replace (e.g. enabled -> pinned)
            const existing = seenIds.get(app.id)
            if (!existing) {
              seenIds.set(app.id, row)
            }
            // else: keep the higher-priority version already stored
          } catch (err) {
            this.skippedCount++
            warnings.push(`Failed to transform ${status} app ${app.id}: ${(err as Error).message}`)
            logger.warn(`Skipping ${status} app ${app.id}`, err as Error)
          }
        }
      }

      // Collect final unique rows, excluding duplicates that were demoted
      // Re-index sortOrder within each status group after dedup
      const statusGroups = new Map<MiniAppStatus, InsertMiniAppRow[]>()
      for (const row of seenIds.values()) {
        const group = statusGroups.get(row.status!) ?? []
        group.push(row)
        statusGroups.set(row.status!, group)
      }

      // Re-assign sortOrder within each group
      this.preparedRows = []
      for (const [, rows] of statusGroups) {
        for (let i = 0; i < rows.length; i++) {
          this.preparedRows.push({ ...rows[i], sortOrder: i })
        }
      }

      logger.info('Preparation completed', {
        appCount: this.preparedRows.length,
        skipped: this.skippedCount,
        byStatus: {
          enabled: statusGroups.get('enabled')?.length ?? 0,
          disabled: statusGroups.get('disabled')?.length ?? 0,
          pinned: statusGroups.get('pinned')?.length ?? 0
        }
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
          await tx.insert(miniappTable).values(batch)
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
      const result = await ctx.db.select({ count: sql<number>`count(*)` }).from(miniappTable).get()
      const appCount = result?.count ?? 0
      const errors: { key: string; message: string }[] = []

      if (appCount !== this.preparedRows.length) {
        errors.push({
          key: 'count_mismatch',
          message: `Expected ${this.preparedRows.length} miniapps but found ${appCount}`
        })
      }

      // Sample validation: check required fields
      const sample = await ctx.db.select().from(miniappTable).limit(5).all()
      for (const app of sample) {
        if (!app.appId || !app.name || !app.url) {
          errors.push({
            key: app.appId ?? 'unknown',
            message: 'Missing required field (appId, name, or url)'
          })
        }
      }

      return {
        success: errors.length === 0,
        errors,
        stats: {
          sourceCount: this.preparedRows.length,
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
          sourceCount: this.preparedRows.length,
          targetCount: 0,
          skippedCount: this.skippedCount
        }
      }
    }
  }
}
