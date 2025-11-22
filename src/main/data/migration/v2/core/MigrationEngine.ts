/**
 * Migration engine orchestrates the entire migration process
 * Coordinates migrators, manages progress, and handles failures
 */

import { dbService } from '@data/db/DbService'
import { appStateTable } from '@data/db/schemas/appState'
import { preferenceTable } from '@data/db/schemas/preference'
import { loggerService } from '@logger'
import type {
  MigrationProgress,
  MigrationResult,
  MigrationStage,
  MigrationStatusValue,
  MigratorResult,
  MigratorStatus,
  ValidateResult
} from '@shared/data/migration/v2/types'
import { eq, sql } from 'drizzle-orm'
import fs from 'fs/promises'

import type { BaseMigrator } from '../migrators/BaseMigrator'
import { createMigrationContext } from './MigrationContext'

// TODO: Import these tables when they are created in user data schema
// import { assistantTable } from '../../db/schemas/assistant'
// import { topicTable } from '../../db/schemas/topic'
// import { messageTable } from '../../db/schemas/message'
// import { fileTable } from '../../db/schemas/file'
// import { knowledgeBaseTable } from '../../db/schemas/knowledgeBase'

const logger = loggerService.withContext('MigrationEngine')

const MIGRATION_V2_STATUS = 'migration_v2_status'

export class MigrationEngine {
  private migrators: BaseMigrator[] = []
  private progressCallback?: (progress: MigrationProgress) => void

  constructor() {}

  /**
   * Register migrators in execution order
   */
  registerMigrators(migrators: BaseMigrator[]): void {
    this.migrators = migrators.sort((a, b) => a.order - b.order)
    logger.info('Migrators registered', {
      migrators: this.migrators.map((m) => ({ id: m.id, name: m.name, order: m.order }))
    })
  }

  /**
   * Set progress callback for UI updates
   */
  onProgress(callback: (progress: MigrationProgress) => void): void {
    this.progressCallback = callback
  }

  /**
   * Check if migration is needed
   */
  //TODO 不能仅仅判断数据库，如果是全新安装，而不是升级上来的用户，其实并不需要迁移，但是按现在的逻辑，还是会进行迁移，这不正确
  async needsMigration(): Promise<boolean> {
    const db = dbService.getDb()
    const status = await db.select().from(appStateTable).where(eq(appStateTable.key, MIGRATION_V2_STATUS)).get()

    // Migration needed if: no status record, or status is not 'completed'
    if (!status?.value) return true

    const statusValue = status.value as MigrationStatusValue
    return statusValue.status !== 'completed'
  }

  /**
   * Get last migration error (for UI display)
   */
  async getLastError(): Promise<string | null> {
    const db = dbService.getDb()
    const status = await db.select().from(appStateTable).where(eq(appStateTable.key, MIGRATION_V2_STATUS)).get()

    if (status?.value) {
      const statusValue = status.value as MigrationStatusValue
      if (statusValue.status === 'failed') {
        return statusValue.error || 'Unknown error'
      }
    }
    return null
  }

  /**
   * Execute full migration
   * @param reduxData - Parsed Redux state data from Renderer
   * @param dexieExportPath - Path to exported Dexie files
   */
  async run(reduxData: Record<string, unknown>, dexieExportPath: string): Promise<MigrationResult> {
    const startTime = Date.now()
    const results: MigratorResult[] = []

    try {
      // Safety check: verify new tables status before clearing
      await this.verifyAndClearNewTables()

      // Create migration context
      const context = createMigrationContext(reduxData, dexieExportPath)

      for (let i = 0; i < this.migrators.length; i++) {
        const migrator = this.migrators[i]
        const migratorStartTime = Date.now()

        logger.info(`Starting migrator: ${migrator.name}`, { id: migrator.id })

        // Update progress: migrator starting
        this.updateProgress('migration', this.calculateProgress(i, 0), migrator)

        // Set up migrator progress callback
        migrator.setProgressCallback((progress, message) => {
          this.updateProgress('migration', this.calculateProgress(i, progress), migrator, message)
        })

        // Phase 1: Prepare (includes dry-run validation)
        const prepareResult = await migrator.prepare(context)
        if (!prepareResult.success) {
          throw new Error(`${migrator.name} prepare failed: ${prepareResult.warnings?.join(', ')}`)
        }

        logger.info(`${migrator.name} prepare completed`, { itemCount: prepareResult.itemCount })

        // Phase 2: Execute (each migrator manages its own transactions)
        const executeResult = await migrator.execute(context)
        if (!executeResult.success) {
          throw new Error(`${migrator.name} execute failed: ${executeResult.error}`)
        }

        logger.info(`${migrator.name} execute completed`, {
          processedCount: executeResult.processedCount
        })

        // Phase 3: Validate
        const validateResult = await migrator.validate(context)

        // Engine-level validation
        this.validateMigratorResult(migrator, validateResult)

        logger.info(`${migrator.name} validation passed`, { stats: validateResult.stats })

        // Record result
        results.push({
          migratorId: migrator.id,
          migratorName: migrator.name,
          success: true,
          recordsProcessed: executeResult.processedCount,
          duration: Date.now() - migratorStartTime
        })

        // Update progress: migrator completed
        this.updateProgress('migration', this.calculateProgress(i + 1, 0), migrator, 'completed')
      }

      // Mark migration completed
      await this.markCompleted()

      // Cleanup temporary files
      await this.cleanupTempFiles(dexieExportPath)

      logger.info('Migration completed successfully', {
        totalDuration: Date.now() - startTime,
        migratorCount: results.length
      })

      return {
        success: true,
        migratorResults: results,
        totalDuration: Date.now() - startTime
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      logger.error('Migration failed', { error: errorMessage })

      // Mark migration as failed with error details
      await this.markFailed(errorMessage)

      return {
        success: false,
        migratorResults: results,
        totalDuration: Date.now() - startTime,
        error: errorMessage
      }
    }
  }

  /**
   * Verify and clear new architecture tables before migration
   * Safety check: log if tables are not empty (may indicate previous failed migration)
   */
  private async verifyAndClearNewTables(): Promise<void> {
    const db = dbService.getDb()

    // Tables to clear - add more as they are created
    const tables = [
      { table: preferenceTable, name: 'preference' }
      // TODO: Add these when tables are created
      // { table: assistantTable, name: 'assistant' },
      // { table: topicTable, name: 'topic' },
      // { table: messageTable, name: 'message' },
      // { table: fileTable, name: 'file' },
      // { table: knowledgeBaseTable, name: 'knowledge_base' }
    ]

    // Check if tables have data (safety check)
    for (const { table, name } of tables) {
      const result = await db.select({ count: sql<number>`count(*)` }).from(table).get()
      const count = result?.count ?? 0
      if (count > 0) {
        logger.warn(`Table '${name}' is not empty (${count} rows), clearing for fresh migration`)
      }
    }

    // Clear tables in reverse dependency order
    // TODO: Add these when tables are created (in correct order)
    // await db.delete(messageTable)
    // await db.delete(topicTable)
    // await db.delete(fileTable)
    // await db.delete(knowledgeBaseTable)
    // await db.delete(assistantTable)
    await db.delete(preferenceTable)

    logger.info('All new architecture tables cleared successfully')
  }

  /**
   * Validate migrator result at engine level
   * Ensures count validation and error checking
   */
  private validateMigratorResult(migrator: BaseMigrator, result: ValidateResult): void {
    const { stats } = result

    // Count validation: target must have at least source count minus skipped
    const expectedCount = stats.sourceCount - stats.skippedCount
    if (stats.targetCount < expectedCount) {
      throw new Error(
        `${migrator.name} count mismatch: ` +
          `expected ${expectedCount}, ` +
          `got ${stats.targetCount}. ${stats.mismatchReason || ''}`
      )
    }

    // Any validation errors are fatal
    if (result.errors.length > 0) {
      const errorSummary = result.errors
        .slice(0, 3)
        .map((e) => e.message)
        .join('; ')
      throw new Error(
        `${migrator.name} validation failed: ${errorSummary}` +
          (result.errors.length > 3 ? ` (+${result.errors.length - 3} more)` : '')
      )
    }
  }

  /**
   * Cleanup temporary export files
   */
  private async cleanupTempFiles(exportPath: string): Promise<void> {
    try {
      await fs.rm(exportPath, { recursive: true, force: true })
      logger.info('Temporary files cleaned up', { path: exportPath })
    } catch (error) {
      logger.warn('Failed to cleanup temp files', { error, path: exportPath })
    }
  }

  /**
   * Calculate overall progress based on completed migrators and current migrator progress
   */
  private calculateProgress(completedMigrators: number, currentMigratorProgress: number): number {
    if (this.migrators.length === 0) return 0
    const migratorWeight = 100 / this.migrators.length
    return Math.round(completedMigrators * migratorWeight + (currentMigratorProgress / 100) * migratorWeight)
  }

  /**
   * Update progress callback with current state
   */
  private updateProgress(
    stage: MigrationStage,
    overallProgress: number,
    currentMigrator: BaseMigrator,
    message?: string
  ): void {
    const migratorsProgress = this.migrators.map((m) => ({
      id: m.id,
      name: m.name,
      status: this.getMigratorStatus(m, currentMigrator)
    }))

    this.progressCallback?.({
      stage,
      overallProgress,
      currentMessage: message || `正在处理${currentMigrator.name}...`,
      migrators: migratorsProgress
    })
  }

  /**
   * Determine migrator status based on execution order
   */
  private getMigratorStatus(migrator: BaseMigrator, current: BaseMigrator): MigratorStatus {
    if (migrator.order < current.order) return 'completed'
    if (migrator.order === current.order) return 'running'
    return 'pending'
  }

  /**
   * Mark migration as completed in app_state
   */
  private async markCompleted(): Promise<void> {
    const db = dbService.getDb()
    const statusValue: MigrationStatusValue = {
      status: 'completed',
      completedAt: Date.now(),
      version: '2.0.0',
      error: null
    }

    await db
      .insert(appStateTable)
      .values({
        key: MIGRATION_V2_STATUS,
        value: statusValue
      })
      .onConflictDoUpdate({
        target: appStateTable.key,
        set: {
          value: statusValue,
          updatedAt: Date.now()
        }
      })
  }

  /**
   * Mark migration as failed in app_state with error details
   */
  private async markFailed(error: string): Promise<void> {
    const db = dbService.getDb()
    const statusValue: MigrationStatusValue = {
      status: 'failed',
      failedAt: Date.now(),
      version: '2.0.0',
      error: error
    }

    await db
      .insert(appStateTable)
      .values({
        key: MIGRATION_V2_STATUS,
        value: statusValue
      })
      .onConflictDoUpdate({
        target: appStateTable.key,
        set: {
          value: statusValue,
          updatedAt: Date.now()
        }
      })
  }
}

// Export singleton instance
export const migrationEngine = new MigrationEngine()
