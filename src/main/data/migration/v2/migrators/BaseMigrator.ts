/**
 * Abstract base class for all migrators
 * Each migrator handles migration of a specific business domain
 */

import type { ExecuteResult, PrepareResult, ValidateResult } from '@shared/data/migration/v2/types'

import type { MigrationContext } from '../core/MigrationContext'

export abstract class BaseMigrator {
  // Metadata - must be implemented by subclasses
  abstract readonly id: string
  abstract readonly name: string // Display name for UI
  abstract readonly description: string // Display description for UI
  abstract readonly order: number // Execution order (lower runs first)

  // Progress callback for UI updates
  protected onProgress?: (progress: number, message: string) => void

  /**
   * Set progress callback for reporting progress to UI
   */
  setProgressCallback(callback: (progress: number, message: string) => void): void {
    this.onProgress = callback
  }

  /**
   * Report progress to UI
   * @param progress - Progress percentage (0-100)
   * @param message - Progress message
   */
  protected reportProgress(progress: number, message: string): void {
    this.onProgress?.(progress, message)
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
