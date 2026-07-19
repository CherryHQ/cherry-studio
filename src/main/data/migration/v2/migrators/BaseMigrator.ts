/**
 * Abstract base class for all migrators
 * Each migrator handles migration of a specific business domain
 */

import type { ExecuteResult, I18nMessage, PrepareResult, ValidateResult } from '@shared/data/migration/v2/types'
import { getTableName, sql } from 'drizzle-orm'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'

import type { MigrationContext } from '../core/MigrationContext'
import {
  type ClassifiedMigrationError,
  classifyMigrationError,
  type PayloadProfileDescriptor,
  profilePayloadLengths
} from '../diagnostics'

export interface ProgressMessage {
  message: string
  i18nMessage?: I18nMessage
}

/** One row of `PRAGMA foreign_key_check` output: a child row whose FK is unsatisfied. */
interface ForeignKeyViolation {
  table: string
  rowid: number | null
  parent: string
  fkid: number
}

export abstract class BaseMigrator {
  // Metadata - must be implemented by subclasses
  abstract readonly id: string
  abstract readonly name: string // Display name for UI
  abstract readonly description: string // Display description for UI
  abstract readonly order: number // Execution order (lower runs first)

  // Progress callback for UI updates
  protected onProgress?: (progress: number, progressMessage: ProgressMessage) => void

  /** Fixed metadata from the latest diagnosed write failure in the current execute attempt. */
  private diagnosedWriteFailure?: ClassifiedMigrationError

  /**
   * Set progress callback for reporting progress to UI
   */
  setProgressCallback(callback: (progress: number, progressMessage: ProgressMessage) => void): void {
    this.onProgress = callback
  }

  /**
   * Reset instance state accumulated from a previous run.
   * MigrationEngine reuses migrator instances and calls this before each run()
   * so retries start with clean counters, caches, and prepared data.
   */
  abstract reset(): void

  /**
   * Report progress to UI
   * @param progress - Progress percentage (0-100)
   * @param message - Progress message (fallback text)
   * @param i18nMessage - Optional i18n key with params for translation
   */
  protected reportProgress(progress: number, message: string, i18nMessage?: I18nMessage): void {
    this.onProgress?.(progress, { message, i18nMessage })
  }

  /**
   * Run one existing synchronous write boundary and capture only bounded shape
   * metadata if it throws. The helper deliberately does not own a transaction,
   * await the callback, clone rows, or inspect error text.
   */
  protected runDiagnosedWrite<T>(
    ctx: MigrationContext,
    descriptor: PayloadProfileDescriptor,
    rows: readonly unknown[],
    write: () => T
  ): T {
    try {
      return write()
    } catch (error) {
      const classification = classifyMigrationError(error)
      this.diagnosedWriteFailure = classification
      try {
        ctx.diagnostics?.recordEvent({
          scope: 'migrator',
          phase: 'execute',
          state: 'failed',
          category: classification.category,
          code: classification.code,
          causeDepth: classification.causeDepth,
          migratorId: this.id,
          payloadProfile: profilePayloadLengths(rows, descriptor)
        })
      } catch {
        ctx.logger?.error('Failed to record bounded migration write diagnostics')
      }
      throw error
    }
  }

  /**
   * Execute with fixed failure metadata available to the main-process engine.
   *
   * Migrators currently return display strings for many fatal write failures,
   * which discards the original SQLite code. This wrapper preserves only the
   * bounded classification and always clears it between attempts.
   */
  async executeWithDiagnostics(ctx: MigrationContext): Promise<{
    result: ExecuteResult
    failureClassification?: ClassifiedMigrationError
  }> {
    this.diagnosedWriteFailure = undefined
    try {
      const result = await this.execute(ctx)
      if (result.success || this.diagnosedWriteFailure === undefined) return { result }
      return { result, failureClassification: this.diagnosedWriteFailure }
    } finally {
      this.diagnosedWriteFailure = undefined
    }
  }

  /** Clear a diagnosed failure after an explicitly non-fatal, best-effort write. */
  protected clearNonterminalDiagnosedFailure(): void {
    this.diagnosedWriteFailure = undefined
  }

  /**
   * Assert foreign-key integrity for the tables this migrator owns.
   *
   * The engine keeps `foreign_keys = OFF` for the entire migration (see
   * MigrationDbService), so FK violations never surface at insert time. This runs a
   * targeted `PRAGMA foreign_key_check(<table>)` per table, catching this domain's
   * referential errors early — with clear attribution to this migrator — instead of
   * deferring every domain's errors to the engine's final `verifyForeignKeys()`.
   *
   * Pass only tables whose FKs should be fully satisfied once THIS migrator finishes.
   * Do NOT pass tables whose references are resolved by a LATER migrator (cross-domain
   * deferred refs, e.g. `assistant_knowledge_base.knowledgeBaseId` before
   * KnowledgeMigrator runs) — those are covered by the engine's final whole-database
   * check, not here.
   *
   * @throws if any owned table has an unsatisfied foreign key.
   */
  protected assertOwnedForeignKeys(db: MigrationContext['db'], tables: SQLiteTable[]): void {
    const violations: ForeignKeyViolation[] = []
    for (const table of tables) {
      // Table names come from drizzle schema objects (compile-time constants), not
      // user input, so the interpolation is safe. foreign_key_check takes no bound params.
      const tableName = getTableName(table)
      const rows = db.all<ForeignKeyViolation>(sql.raw(`PRAGMA foreign_key_check("${tableName}")`))
      violations.push(...rows)
    }

    if (violations.length > 0) {
      throw new Error(
        `${this.name}Migrator left ${violations.length} foreign-key violation(s): ` +
          violations
            .slice(0, 5)
            .map((v) => `${v.table}->${v.parent} (rowid=${v.rowid})`)
            .join(', ')
      )
    }
  }

  /**
   * Prepare phase - validate source data and count items
   * This includes dry-run validation to catch errors early
   */
  abstract prepare(ctx: MigrationContext): Promise<PrepareResult>

  /**
   * Execute phase - perform the actual data migration
   * Each migrator manages its own transactions
   */
  abstract execute(ctx: MigrationContext): Promise<ExecuteResult>

  /**
   * Validate phase - verify migrated data integrity
   * Must include count validation
   */
  abstract validate(ctx: MigrationContext): Promise<ValidateResult>
}
