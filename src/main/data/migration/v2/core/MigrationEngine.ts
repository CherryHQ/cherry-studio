/**
 * Migration engine orchestrates the entire migration process
 * Coordinates migrators, manages progress, and handles failures
 */

import { agentTable } from '@data/db/schemas/agent'
import { agentChannelTable, agentChannelTaskTable } from '@data/db/schemas/agentChannel'
import { agentGlobalSkillTable } from '@data/db/schemas/agentGlobalSkill'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentSkillTable } from '@data/db/schemas/agentSkill'
import { agentTaskRunLogTable, agentTaskTable } from '@data/db/schemas/agentTask'
import { appStateTable } from '@data/db/schemas/appState'
import { assistantTable } from '@data/db/schemas/assistant'
import { assistantKnowledgeBaseTable, assistantMcpServerTable } from '@data/db/schemas/assistantRelations'
import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { mcpServerTable } from '@data/db/schemas/mcpServer'
import { messageTable } from '@data/db/schemas/message'
import { miniappTable } from '@data/db/schemas/miniapp'
import { pinTable } from '@data/db/schemas/pin'
import { preferenceTable } from '@data/db/schemas/preference'
import { topicTable } from '@data/db/schemas/topic'
import { translateHistoryTable } from '@data/db/schemas/translateHistory'
import { translateLanguageTable } from '@data/db/schemas/translateLanguage'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import type { DbType } from '@data/db/types'
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
import Store from 'electron-store'
import fs from 'fs/promises'
import path from 'path'

import type { BaseMigrator, ProgressMessage } from '../migrators/BaseMigrator'
import { createMigrationContext } from './MigrationContext'
import { MigrationDbService } from './MigrationDbService'
import type { MigrationPaths } from './MigrationPaths'

// TODO: Import these tables when they are created in user data schema
// import { assistantTable } from '../../db/schemas/assistant'
// import { fileTable } from '../../db/schemas/file'

const logger = loggerService.withContext('MigrationEngine')

const MIGRATION_V2_STATUS = 'migration_v2_status'

export class MigrationEngine {
  private migrators: BaseMigrator[] = []
  private progressCallback?: (progress: MigrationProgress) => void
  private migrationDb: MigrationDbService | null = null
  private _paths: MigrationPaths | null = null

  get paths(): MigrationPaths {
    if (!this._paths) {
      throw new Error('MigrationEngine not initialized — call initialize() first')
    }
    return this._paths
  }

  /**
   * Initialize the migration engine by creating a bare DB connection.
   * Must be called before needsMigration() or run().
   */
  async initialize(paths: MigrationPaths): Promise<void> {
    this._paths = paths
    this.migrationDb = await MigrationDbService.create(paths)
  }

  /**
   * Close the bare DB connection. Call when migration is not needed.
   */
  close(): void {
    this.migrationDb?.close()
    this.migrationDb = null
  }

  private getDb(): DbType {
    if (!this.migrationDb) {
      throw new Error('MigrationEngine not initialized — call initialize() first')
    }
    return this.migrationDb.getDb()
  }

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
    const db = this.getDb()
    const status = await db.select().from(appStateTable).where(eq(appStateTable.key, MIGRATION_V2_STATUS)).get()

    if (status?.value) {
      const statusValue = status.value as MigrationStatusValue
      return statusValue.status !== 'completed'
    }

    // No migration status record — check if this is a fresh install or an upgrade.
    if (!this.hasLegacyData()) {
      logger.info('Fresh install detected (no legacy data found), skipping migration')
      await this.markCompleted()
      return false
    }

    return true
  }

  /**
   * Heuristic fallback for fresh-install detection.
   * Version-based upgrade path validation is enforced in
   * v2MigrationGate.ts (via versionPolicy.ts) BEFORE this method
   * is called. This heuristic only needs to distinguish "fresh
   * install" from "upgrade with legacy data".
   *
   * Known limitation: electron-store (config.json) may be written
   * by v2, causing false positives. Prefer to over-trigger (empty-
   * data migration completes safely) rather than miss a real upgrade.
   */
  private hasLegacyData(): boolean {
    const legacyStore = new Store({ cwd: this.paths.userData })
    const hasData = legacyStore.size > 0

    logger.info('Legacy data detection', { hasElectronStore: hasData })
    return hasData
  }

  /**
   * Get last migration error (for UI display)
   */
  async getLastError(): Promise<string | null> {
    const db = this.getDb()
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
  async run(
    reduxData: Record<string, unknown>,
    dexieExportPath: string,
    localStorageExportPath?: string
  ): Promise<MigrationResult> {
    const startTime = Date.now()
    const results: MigratorResult[] = []

    try {
      for (const migrator of this.migrators) {
        migrator.reset()
      }

      // Safety check: verify new tables status before clearing
      await this.verifyAndClearNewTables()

      // Create migration context
      const context = await createMigrationContext(
        this.getDb(),
        this.paths,
        reduxData,
        dexieExportPath,
        localStorageExportPath
      )

      for (let i = 0; i < this.migrators.length; i++) {
        const migrator = this.migrators[i]
        const migratorStartTime = Date.now()

        logger.info(`Starting migrator: ${migrator.name}`, { id: migrator.id })

        // Update progress: migrator starting
        this.updateProgress('migration', this.calculateProgress(i, 0), migrator)

        // Set up migrator progress callback
        migrator.setProgressCallback((progress, progressMessage) => {
          this.updateProgress('migration', this.calculateProgress(i, progress), migrator, progressMessage)
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
        this.updateProgress('migration', this.calculateProgress(i + 1, 0), migrator)
      }

      // Verify FK integrity after all inserts (FK was off during bulk inserts)
      await this.verifyForeignKeys()

      // Mark migration completed
      await this.markCompleted()

      // Cleanup temporary files
      await this.cleanupTempFiles(dexieExportPath)

      if (localStorageExportPath) {
        await this.cleanupTempFiles(path.dirname(localStorageExportPath))
      }

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
    const db = this.getDb()

    // Tables to clear - add more as they are created
    // Order matters: child tables must be cleared before parent tables
    const tables = [
      { table: pinTable, name: 'pin' },
      { table: userModelTable, name: 'user_model' }, // Must clear before user_provider
      { table: userProviderTable, name: 'user_provider' },
      { table: messageTable, name: 'message' }, // Must clear before topic (FK reference)
      { table: topicTable, name: 'topic' }, // Must clear before assistant (FK reference)
      { table: assistantMcpServerTable, name: 'assistant_mcp_server' }, // Junction: clear before assistant
      { table: assistantKnowledgeBaseTable, name: 'assistant_knowledge_base' }, // Junction: clear before assistant
      { table: assistantTable, name: 'assistant' },
      { table: mcpServerTable, name: 'mcp_server' },
      { table: miniappTable, name: 'miniapp' },
      { table: preferenceTable, name: 'preference' },
      { table: translateHistoryTable, name: 'translate_history' },
      { table: translateLanguageTable, name: 'translate_language' },
      { table: knowledgeItemTable, name: 'knowledge_item' }, // Must clear before knowledge_base (FK reference)
      { table: knowledgeBaseTable, name: 'knowledge_base' },
      // Agents-domain tables — child → parent order
      { table: agentSessionMessageTable, name: 'agent_session_message' },
      { table: agentChannelTaskTable, name: 'agent_channel_task' },
      { table: agentTaskRunLogTable, name: 'agent_task_run_log' },
      { table: agentChannelTable, name: 'agent_channel' },
      { table: agentTaskTable, name: 'agent_task' },
      { table: agentSkillTable, name: 'agent_skill' },
      { table: agentSessionTable, name: 'agent_session' },
      { table: agentGlobalSkillTable, name: 'agent_global_skill' },
      { table: agentTable, name: 'agent' }
      // TODO: Add fileTable when created
    ]

    // Check if tables have data (safety check)
    for (const { table, name } of tables) {
      const result = await db.select({ count: sql<number>`count(*)` }).from(table).get()
      const count = result?.count ?? 0
      if (count > 0) {
        logger.warn(`Table '${name}' is not empty (${count} rows), clearing for fresh migration`)
      }
    }

    // Clear tables in dependency order (children before parents)
    await db.delete(pinTable)
    await db.delete(userModelTable)
    await db.delete(userProviderTable)
    await db.delete(messageTable) // FK → topic
    await db.delete(topicTable) // FK → assistant
    await db.delete(assistantMcpServerTable) // FK → assistant, mcp_server
    await db.delete(assistantKnowledgeBaseTable) // FK → assistant
    await db.delete(assistantTable)
    await db.delete(mcpServerTable)
    await db.delete(miniappTable)
    await db.delete(preferenceTable)
    await db.delete(translateHistoryTable)
    await db.delete(translateLanguageTable)
    await db.delete(knowledgeItemTable) // FK → knowledge_base
    await db.delete(knowledgeBaseTable)
    // Agents-domain cleanup — child → parent order
    await db.delete(agentSessionMessageTable) // FK → agent_session
    await db.delete(agentChannelTaskTable) // FK → agent_channel, agent_task
    await db.delete(agentTaskRunLogTable) // FK → agent_task
    await db.delete(agentChannelTable) // FK → agent, agent_session
    await db.delete(agentTaskTable) // FK → agent
    await db.delete(agentSkillTable) // FK → agent, agent_global_skill
    await db.delete(agentSessionTable) // FK → agent
    await db.delete(agentGlobalSkillTable)
    await db.delete(agentTable)

    logger.info('All new architecture tables cleared successfully')
  }

  /**
   * Verify foreign key integrity after all data has been inserted.
   * FK constraints were disabled during bulk inserts for performance;
   * this post-insert check ensures referential integrity is correct.
   */
  private async verifyForeignKeys(): Promise<void> {
    const db = this.getDb()

    // PRAGMA foreign_key_check scans ALL tables for FK violations.
    // Returns rows: { table, rowid, parent, fkid } for each violation.
    const violations = await db.all<{ table: string; rowid: number; parent: string; fkid: number }>(
      sql`PRAGMA foreign_key_check`
    )

    if (violations.length > 0) {
      const sample = violations
        .slice(0, 5)
        .map((v) => `${v.table}(rowid=${v.rowid})→${v.parent}`)
        .join('; ')
      throw new Error(`Foreign key check failed: ${violations.length} violation(s). Sample: ${sample}`)
    }

    logger.info('Foreign key integrity verified')
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
      // Migration is already marked completed at this point; cleanup failure
      // accumulates Dexie export blobs across retries with no error signal
      // unless we surface it as `error`. Keep migration result successful.
      logger.error('Failed to cleanup temp files', error as Error, { path: exportPath })
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
    progressMessage?: ProgressMessage
  ): void {
    const migratorsProgress = this.migrators.map((m) => ({
      id: m.id,
      name: m.name,
      status: this.getMigratorStatus(m, currentMigrator)
    }))

    const defaultMessage = `Processing ${currentMigrator.name}...`
    const defaultI18n = { key: 'migration.progress.processing', params: { name: currentMigrator.name } }

    this.progressCallback?.({
      stage,
      overallProgress,
      currentMessage: progressMessage?.message || defaultMessage,
      i18nMessage: progressMessage?.i18nMessage || defaultI18n,
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
   * Skip migration entirely (user chose to ignore old data and use defaults).
   * Marks migration as completed so the gate will not trigger on next launch.
   */
  async skipMigration(): Promise<void> {
    logger.info('Migration skipped by user (version incompatible, using defaults)')
    await this.markCompleted()
  }

  /**
   * Mark migration as completed in app_state
   */
  private async markCompleted(): Promise<void> {
    const db = this.getDb()
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
    const db = this.getDb()
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
