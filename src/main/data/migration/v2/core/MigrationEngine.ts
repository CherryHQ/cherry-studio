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
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { appStateTable } from '@data/db/schemas/appState'
import { assistantTable } from '@data/db/schemas/assistant'
import {
  agentMcpServerTable,
  assistantKnowledgeBaseTable,
  assistantMcpServerTable
} from '@data/db/schemas/assistantRelations'
import { fileEntryTable } from '@data/db/schemas/file'
import {
  chatMessageFileRefTable,
  miniAppLogoFileRefTable,
  paintingFileRefTable,
  providerLogoFileRefTable
} from '@data/db/schemas/fileRelations'
import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { mcpServerTable } from '@data/db/schemas/mcpServer'
import { messageTable } from '@data/db/schemas/message'
import { miniAppTable } from '@data/db/schemas/miniApp'
import { noteTable } from '@data/db/schemas/note'
import { paintingTable } from '@data/db/schemas/painting'
import { pinTable } from '@data/db/schemas/pin'
import { preferenceTable } from '@data/db/schemas/preference'
import { promptTable } from '@data/db/schemas/prompt'
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

import {
  type ClassifiedMigrationError,
  classifyMigrationError,
  type MigrationDatabaseDiagnosticResult,
  type MigrationDatabaseDiagnostics,
  type MigrationDiagnosticEventInput
} from '../diagnostics'
import type { BaseMigrator, ProgressMessage } from '../migrators/BaseMigrator'
import { createMigrationContext, type MigrationAttemptDiagnostics } from './MigrationContext'
import { MigrationDbService } from './MigrationDbService'
import type { MigrationPaths } from './MigrationPaths'

const logger = loggerService.withContext('MigrationEngine')

const MIGRATION_V2_STATUS = 'migration_v2_status'

const NOOP_MIGRATION_DIAGNOSTICS: MigrationAttemptDiagnostics = {
  recordEvent: () => {},
  finishAttempt: () => {},
  complete: () => {}
}

class MigratorResultError extends Error {
  constructor(
    message: string,
    readonly failureClassification?: ClassifiedMigrationError
  ) {
    super(message)
    this.name = 'MigratorResultError'
  }
}

export class MigrationEngine {
  private migrators: BaseMigrator[] = []
  private progressCallback?: (progress: MigrationProgress) => void
  private migrationDb: MigrationDbService | null = null
  private _paths: MigrationPaths | null = null
  private legacyDataConfirmed = false
  private diagnostics: MigrationAttemptDiagnostics = NOOP_MIGRATION_DIAGNOSTICS

  get paths(): MigrationPaths {
    if (!this._paths) {
      throw new Error('MigrationEngine not initialized — call initialize() first')
    }
    return this._paths
  }

  /**
   * Initialize the migration engine by creating a bare DB connection.
   * Must be called before needsMigration() or run().
   *
   * @param legacyDataConfirmed Whether the gate confirmed the resolved userData
   *   holds v1 data (see MigrationPaths.resolveMigrationPaths). Stored and read
   *   by needsMigration() so a redirected-but-electron-store-empty directory is
   *   never markCompleted-locked as a "fresh install".
   */
  initialize(
    paths: MigrationPaths,
    legacyDataConfirmed = false,
    diagnostics: MigrationAttemptDiagnostics = NOOP_MIGRATION_DIAGNOSTICS
  ): void {
    this._paths = paths
    this.legacyDataConfirmed = legacyDataConfirmed
    this.diagnostics = diagnostics
    this.recordDiagnosticEvent({
      scope: 'database',
      phase: 'initialize',
      state: 'started',
      code: 'unknown'
    })
    try {
      this.migrationDb = MigrationDbService.create(paths)
      this.recordDiagnosticEvent({
        scope: 'database',
        phase: 'initialize',
        state: 'completed',
        code: 'unknown'
      })
    } catch (error) {
      this.recordClassifiedFailure('database', 'initialize', error)
      throw error
    }
  }

  /**
   * Close the bare DB connection. Call when migration is not needed.
   */
  close(): void {
    this.migrationDb?.close()
    this.migrationDb = null
  }

  async collectDatabaseDiagnostics(
    diagnostics: MigrationDatabaseDiagnostics
  ): Promise<MigrationDatabaseDiagnosticResult> {
    const databaseFile = this.paths.databaseFile
    const migrationDb = this.migrationDb
    if (migrationDb === null) return diagnostics.inspect(databaseFile)

    const inspected = await migrationDb.withDiagnosticsLease((lease) => diagnostics.inspectWithLease(lease))
    return inspected.kind === 'leased' ? inspected.value : diagnostics.inspect(databaseFile)
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
   * Check if migration is needed.
   *
   * With a stored migration status, the status decides. Without one, this is a
   * first launch: migrate iff there is legacy data. `legacyDataConfirmed` (from
   * the gate's path resolution) is the authoritative signal — it recognizes v1
   * data via version.log / Chromium storage / config keys, markers the narrower
   * `hasLegacyData()` electron-store probe misses. ORing them prevents a
   * redirected custom directory whose electron-store happens to be empty from
   * being mis-detected as a fresh install and markCompleted-locked forever.
   */
  async needsMigration(): Promise<boolean> {
    const db = this.getDb()
    const status = db.select().from(appStateTable).where(eq(appStateTable.key, MIGRATION_V2_STATUS)).get()

    if (status?.value) {
      const statusValue = status.value as MigrationStatusValue
      return statusValue.status !== 'completed'
    }

    // No migration status record — check if this is a fresh install or an upgrade.
    if (this.legacyDataConfirmed || this.hasLegacyData()) {
      return true
    }

    logger.info('Fresh install detected (no legacy data found), skipping migration')
    await this.markCompleted()
    return false
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
  getLastError(): string | null {
    const db = this.getDb()
    const status = db.select().from(appStateTable).where(eq(appStateTable.key, MIGRATION_V2_STATUS)).get()

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
      await this.runDiagnosticBoundary('database', 'initialize', () => this.verifyAndClearNewTables())

      // Create migration context
      const context = await this.runDiagnosticBoundary('engine', 'initialize', () =>
        createMigrationContext(
          this.getDb(),
          this.paths,
          reduxData,
          dexieExportPath,
          localStorageExportPath,
          this.diagnostics
        )
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
        const prepareResult = await this.runDiagnosticBoundary(
          'migrator',
          'prepare',
          async () => {
            const { result, failureClassification } = await migrator.prepareWithDiagnostics(context)
            if (!result.success) {
              const reason = result.error ?? result.warnings?.join(', ') ?? 'unknown reason'
              throw new MigratorResultError(`${migrator.name} prepare failed: ${reason}`, failureClassification)
            }
            return result
          },
          migrator.id
        )

        logger.info(`${migrator.name} prepare completed`, { itemCount: prepareResult.itemCount })

        // Phase 2: Execute (each migrator manages its own transactions)
        const executeResult = await this.runDiagnosticBoundary(
          'migrator',
          'execute',
          async () => {
            const { result, failureClassification } = await migrator.executeWithDiagnostics(context)
            if (!result.success) {
              throw new MigratorResultError(`${migrator.name} execute failed: ${result.error}`, failureClassification)
            }
            return result
          },
          migrator.id
        )

        logger.info(`${migrator.name} execute completed`, {
          processedCount: executeResult.processedCount
        })

        // Phase 3: Validate
        const validateResult = await this.runDiagnosticBoundary(
          'migrator',
          'validate',
          async () => {
            const { result, failureClassification } = await migrator.validateWithDiagnostics(context)
            try {
              // Engine-level validation
              this.validateMigratorResult(migrator, result)
            } catch (error) {
              if (failureClassification) {
                throw new MigratorResultError(this.normalizeDisplayError(error).message, failureClassification)
              }
              throw error
            }
            return result
          },
          migrator.id
        )

        logger.info(`${migrator.name} validation passed`, { stats: validateResult.stats })

        // Non-fatal diagnostics from both phases. Prepare warnings were previously only
        // read on prepare failure; surface them on the success path too, alongside any
        // execute-phase warnings (e.g. knowledge files kept but not reindexable).
        const warnings = [...(prepareResult.warnings ?? []), ...(executeResult.warnings ?? [])]
        if (warnings.length > 0) {
          logger.warn(`${migrator.name} completed with ${warnings.length} warning(s)`, { warnings })
        }

        // Record result
        results.push({
          migratorId: migrator.id,
          migratorName: migrator.name,
          success: true,
          recordsProcessed: executeResult.processedCount,
          duration: Date.now() - migratorStartTime,
          ...(warnings.length > 0 ? { warnings } : {})
        })

        // Update progress: migrator completed
        this.updateProgress('migration', this.calculateProgress(i + 1, 0), migrator)
      }

      // Verify FK integrity after all inserts (FK was off during bulk inserts)
      await this.runDiagnosticBoundary('database', 'validate', () => this.verifyForeignKeys())

      // Mark migration completed
      await this.runDiagnosticBoundary('database', 'finalize', () => this.markCompleted())

      const attemptFinished = this.finishDiagnosticAttempt('completed', {
        scope: 'engine',
        phase: 'finalize',
        state: 'completed',
        code: 'unknown'
      })
      if (attemptFinished) {
        this.completeDiagnostics()
      }

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
      // Classify while the original thrown value is still intact and before the
      // migration-status write, whose own failure must remain secondary.
      const originalClassification = this.classifyDiagnosticError(error)
      const err = this.normalizeDisplayError(error)
      const errorMessage = err.message

      logger.error('Migration failed', err)

      // Mark migration as failed with error details. A secondary status-write
      // error is recorded independently and never replaces the migration error.
      this.recordDiagnosticEvent({
        scope: 'database',
        phase: 'finalize',
        state: 'started',
        code: 'unknown'
      })
      try {
        await this.markFailed(errorMessage)
        this.recordDiagnosticEvent({
          scope: 'database',
          phase: 'finalize',
          state: 'completed',
          code: 'unknown'
        })
      } catch (statusError) {
        logger.error('Failed to persist migration failure status', statusError as Error)
        this.recordClassifiedFailure('database', 'finalize', statusError)
      }

      this.finishDiagnosticAttempt('failed', {
        scope: 'engine',
        phase: 'finalize',
        state: 'failed',
        category: originalClassification.category,
        code: originalClassification.code,
        causeDepth: originalClassification.causeDepth
      })

      return {
        success: false,
        migratorResults: results,
        totalDuration: Date.now() - startTime,
        error: errorMessage
      }
    }
  }

  private async runDiagnosticBoundary<T>(
    scope: MigrationDiagnosticEventInput['scope'],
    phase: MigrationDiagnosticEventInput['phase'],
    operation: () => T | Promise<T>,
    migratorId?: string
  ): Promise<T> {
    this.recordDiagnosticEvent({
      scope,
      phase,
      state: 'started',
      code: 'unknown',
      ...(migratorId ? { migratorId } : {})
    })
    try {
      const result = await operation()
      this.recordDiagnosticEvent({
        scope,
        phase,
        state: 'completed',
        code: 'unknown',
        ...(migratorId ? { migratorId } : {})
      })
      return result
    } catch (error) {
      this.recordClassifiedFailure(scope, phase, error, migratorId)
      throw error
    }
  }

  private recordClassifiedFailure(
    scope: MigrationDiagnosticEventInput['scope'],
    phase: MigrationDiagnosticEventInput['phase'],
    error: unknown,
    migratorId?: string
  ): void {
    const classification = this.classifyDiagnosticError(error)
    this.recordDiagnosticEvent({
      scope,
      phase,
      state: 'failed',
      category: classification.category,
      code: classification.code,
      causeDepth: classification.causeDepth,
      ...(migratorId ? { migratorId } : {})
    })
  }

  private recordDiagnosticEvent(input: MigrationDiagnosticEventInput): void {
    try {
      this.diagnostics.recordEvent(input)
    } catch {
      logger.error('Failed to record bounded migration diagnostic event')
    }
  }

  private classifyDiagnosticError(error: unknown): ClassifiedMigrationError {
    if (error instanceof MigratorResultError && error.failureClassification) {
      return error.failureClassification
    }
    return classifyMigrationError(error)
  }

  private finishDiagnosticAttempt(
    outcome: 'completed' | 'failed',
    terminalInput: MigrationDiagnosticEventInput
  ): boolean {
    try {
      this.diagnostics.finishAttempt(outcome, terminalInput)
      return true
    } catch {
      logger.error('Failed to record bounded migration diagnostic terminal event')
      return false
    }
  }

  private completeDiagnostics(): void {
    try {
      this.diagnostics.complete()
    } catch {
      logger.error('Failed to clean up completed migration diagnostics')
    }
  }

  private normalizeDisplayError(error: unknown): Error {
    if (error instanceof Error) return error
    try {
      return new Error(String(error))
    } catch {
      return new Error('Unknown migration error')
    }
  }

  /**
   * Verify and clear new architecture tables before migration
   * Safety check: log if tables are not empty (may indicate previous failed migration)
   */
  private verifyAndClearNewTables(): void {
    const db = this.getDb()

    // Tables to clear - add more as they are created
    // Order matters: child tables must be cleared before parent tables
    const tables = [
      { table: pinTable, name: 'pin' },
      { table: userModelTable, name: 'user_model' }, // Must clear before user_provider
      { table: userProviderTable, name: 'user_provider' },
      { table: messageTable, name: 'message' }, // Must clear before topic (FK reference)
      { table: topicTable, name: 'topic' }, // Must clear before assistant (FK reference)
      { table: paintingTable, name: 'painting' },
      { table: assistantMcpServerTable, name: 'assistant_mcp_server' }, // Junction: clear before assistant
      { table: assistantKnowledgeBaseTable, name: 'assistant_knowledge_base' }, // Junction: clear before assistant
      { table: assistantTable, name: 'assistant' },
      { table: mcpServerTable, name: 'mcp_server' },
      { table: miniAppTable, name: 'mini_app' },
      { table: preferenceTable, name: 'preference' },
      { table: noteTable, name: 'note' },
      { table: translateHistoryTable, name: 'translate_history' },
      { table: translateLanguageTable, name: 'translate_language' },
      { table: knowledgeItemTable, name: 'knowledge_item' }, // Must clear before knowledge_base (FK reference)
      { table: knowledgeBaseTable, name: 'knowledge_base' },
      { table: promptTable, name: 'prompt' },
      // Agents-domain tables — child → parent order
      { table: agentSessionMessageTable, name: 'agent_session_message' },
      { table: agentChannelTaskTable, name: 'agent_channel_task' },
      { table: agentMcpServerTable, name: 'agent_mcp_server' },
      { table: agentChannelTable, name: 'agent_channel' },
      // agent_task / agent_task_run_log dropped — migrated to JobManager (aac75929c5)
      { table: agentSkillTable, name: 'agent_skill' },
      { table: agentSessionTable, name: 'agent_session' }, // FK → agent_workspace (ON DELETE set null)
      { table: agentWorkspaceTable, name: 'agent_workspace' },
      { table: agentGlobalSkillTable, name: 'agent_global_skill' },
      { table: agentTable, name: 'agent' },
      // File-domain tables. Migration runs with FK checks disabled, but keep ref tables before file_entry for readability.
      { table: chatMessageFileRefTable, name: 'chat_message_file_ref' },
      { table: paintingFileRefTable, name: 'painting_file_ref' },
      { table: providerLogoFileRefTable, name: 'provider_logo_file_ref' },
      { table: miniAppLogoFileRefTable, name: 'mini_app_logo_file_ref' },
      { table: fileEntryTable, name: 'file_entry' }
    ]

    // Check if tables have data (safety check)
    for (const { table, name } of tables) {
      const result = db.select({ count: sql<number>`count(*)` }).from(table).get()
      const count = result?.count ?? 0
      if (count > 0) {
        logger.warn(`Table '${name}' is not empty (${count} rows), clearing for fresh migration`)
      }
    }

    // Clear tables atomically in dependency order (children before parents).
    db.transaction((tx) => {
      for (const { table } of tables) {
        tx.delete(table).run()
      }
    })

    logger.info('All new architecture tables cleared successfully')
  }

  /**
   * Verify foreign key integrity after all data has been inserted.
   * FK constraints were disabled during bulk inserts for performance;
   * this post-insert check ensures referential integrity is correct.
   */
  private verifyForeignKeys(): void {
    const db = this.getDb()

    // PRAGMA foreign_key_check scans ALL tables for FK violations.
    // Returns rows: { table, rowid, parent, fkid } for each violation.
    const violations = db.all<{ table: string; rowid: number; parent: string; fkid: number }>(
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
      // logger.error not warn — migration is already "completed" so a silent
      // failure here leaks Dexie export blobs across retries.
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
    const attemptFinished = this.finishDiagnosticAttempt('completed', {
      scope: 'engine',
      phase: 'finalize',
      state: 'completed',
      code: 'unknown'
    })
    if (attemptFinished) {
      this.completeDiagnostics()
    }
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
