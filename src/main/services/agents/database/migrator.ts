import { Client } from '@libsql/client'
import { loggerService } from '@logger'
import crypto from 'crypto'

import {
  Migration,
  MigrationOptions,
  MigrationRecord,
  MigrationResult,
  MigrationSummary,
  ValidationResult
} from './migrations/types'
import * as MigrationSchema from './schema/migrations'

const logger = loggerService.withContext('Migrator')

/**
 * Database migration manager with transaction support
 * 
 * This class manages database schema evolution through migrations.
 * All table and index definitions are maintained exclusively in migration files,
 * providing a single source of truth for the database schema.
 */
export class Migrator {
  private db: Client
  private migrations: Migration[] = []

  constructor(database: Client) {
    this.db = database
  }

  /**
   * Register a migration to be managed by this migrator
   */
  addMigration(migration: Migration): void {
    // Validate migration
    if (!migration.id) {
      throw new Error('Migration must have an ID')
    }
    if (!migration.description) {
      throw new Error('Migration must have a description')
    }
    if (!migration.up || migration.up.length === 0) {
      throw new Error('Migration must have up statements')
    }

    // Check for duplicate migration IDs
    if (this.migrations.some((m) => m.id === migration.id)) {
      throw new Error(`Migration with ID '${migration.id}' already exists`)
    }

    this.migrations.push(migration)
    logger.debug(`Registered migration: ${migration.id} - ${migration.description}`)
  }

  /**
   * Register multiple migrations
   */
  addMigrations(migrations: Migration[]): void {
    for (const migration of migrations) {
      this.addMigration(migration)
    }
  }

  /**
   * Initialize the migration system by creating the migrations tracking table
   */
  async initialize(): Promise<void> {
    try {
      logger.info('Initializing migration system...')

      // Create migrations table if it doesn't exist
      await this.db.execute(MigrationSchema.createMigrationsTable)

      // Create indexes for migrations table
      for (const indexQuery of MigrationSchema.createMigrationsIndexes) {
        await this.db.execute(indexQuery)
      }

      logger.info('Migration system initialized successfully')
    } catch (error) {
      logger.error('Failed to initialize migration system:', error as Error)
      throw new Error(`Migration system initialization failed: ${(error as Error).message}`)
    }
  }

  /**
   * Get a summary of migration status
   */
  async getMigrationSummary(): Promise<MigrationSummary> {
    const appliedMigrations = await this.getAppliedMigrations()
    const appliedIds = new Set(appliedMigrations.map((m) => m.id))
    const pendingMigrations = this.migrations.filter((m) => !appliedIds.has(m.id))

    const currentVersion = appliedMigrations.length > 0 ? appliedMigrations[appliedMigrations.length - 1].id : '0'

    return {
      totalMigrations: this.migrations.length,
      appliedMigrations: appliedMigrations.length,
      pendingMigrations: pendingMigrations.length,
      pendingMigrationIds: pendingMigrations.map((m) => m.id).sort(),
      currentVersion
    }
  }

  /**
   * Validate all registered migrations
   */
  async validateMigrations(): Promise<ValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []

    // Check for sequential migration IDs
    const sortedMigrations = [...this.migrations].sort((a, b) => a.id.localeCompare(b.id))

    // Check for gaps in migration sequence
    for (let i = 1; i < sortedMigrations.length; i++) {
      const current = sortedMigrations[i]
      const previous = sortedMigrations[i - 1]

      // Simple numeric check for sequential IDs
      const currentNum = parseInt(current.id)
      const previousNum = parseInt(previous.id)

      if (!isNaN(currentNum) && !isNaN(previousNum)) {
        if (currentNum - previousNum !== 1) {
          warnings.push(`Potential gap in migration sequence: ${previous.id} -> ${current.id}`)
        }
      }
    }

    // Validate applied migrations against registered ones
    try {
      const appliedMigrations = await this.getAppliedMigrations()
      const registeredIds = new Set(this.migrations.map((m) => m.id))

      for (const applied of appliedMigrations) {
        if (!registeredIds.has(applied.id)) {
          errors.push(`Applied migration '${applied.id}' is not registered`)
        } else {
          // Validate checksum if migration is registered
          const migration = this.migrations.find((m) => m.id === applied.id)
          if (migration) {
            const expectedChecksum = this.calculateChecksum(migration)
            if (applied.checksum !== expectedChecksum) {
              errors.push(
                `Checksum mismatch for migration '${applied.id}'. Migration may have been modified after application.`
              )
            }
          }
        }
      }
    } catch (error) {
      warnings.push(`Could not validate applied migrations: ${(error as Error).message}`)
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    }
  }

  /**
   * Run all pending migrations
   */
  async migrate(options: MigrationOptions = {}): Promise<MigrationResult[]> {
    const { useTransaction = true, validateChecksums = true, limit, dryRun = false } = options

    logger.info('Starting migration process...', { options })

    // Validate migrations first
    if (validateChecksums) {
      const validation = await this.validateMigrations()
      if (!validation.isValid) {
        throw new Error(`Migration validation failed: ${validation.errors.join(', ')}`)
      }
      if (validation.warnings.length > 0) {
        logger.warn('Migration warnings:', validation.warnings)
      }
    }

    // Get pending migrations
    const appliedMigrations = await this.getAppliedMigrations()
    const appliedIds = new Set(appliedMigrations.map((m) => m.id))
    const pendingMigrations = this.migrations
      .filter((m) => !appliedIds.has(m.id))
      .sort((a, b) => a.id.localeCompare(b.id))

    if (pendingMigrations.length === 0) {
      logger.info('No pending migrations to run')
      return []
    }

    // Apply limit if specified
    const migrationsToRun = limit ? pendingMigrations.slice(0, limit) : pendingMigrations

    logger.info(`Running ${migrationsToRun.length} pending migrations`, {
      migrations: migrationsToRun.map((m) => `${m.id}: ${m.description}`)
    })

    if (dryRun) {
      logger.info('DRY RUN: Migrations that would be applied:', {
        migrations: migrationsToRun.map((m) => `${m.id}: ${m.description}`)
      })
      return []
    }

    const results: MigrationResult[] = []

    for (const migration of migrationsToRun) {
      const result = useTransaction
        ? await this.runMigrationWithTransaction(migration)
        : await this.runMigration(migration)

      results.push(result)

      if (!result.success) {
        logger.error(`Migration ${migration.id} failed, stopping migration process`)
        break
      }
    }

    const successCount = results.filter((r) => r.success).length
    const failCount = results.length - successCount

    logger.info(`Migration process completed. Success: ${successCount}, Failed: ${failCount}`)

    return results
  }

  /**
   * Rollback the last applied migration
   */
  async rollbackLast(): Promise<MigrationResult | null> {
    const appliedMigrations = await this.getAppliedMigrations()

    if (appliedMigrations.length === 0) {
      logger.info('No migrations to rollback')
      return null
    }

    const lastApplied = appliedMigrations[appliedMigrations.length - 1]
    const migration = this.migrations.find((m) => m.id === lastApplied.id)

    if (!migration) {
      throw new Error(`Cannot rollback migration '${lastApplied.id}': migration not registered`)
    }

    if (!migration.down || migration.down.length === 0) {
      throw new Error(`Cannot rollback migration '${lastApplied.id}': no down migration defined`)
    }

    logger.info(`Rolling back migration: ${migration.id} - ${migration.description}`)

    return await this.runRollback(migration)
  }

  /**
   * Get all applied migrations from the database
   */
  private async getAppliedMigrations(): Promise<MigrationRecord[]> {
    try {
      const result = await this.db.execute(MigrationSchema.getAppliedMigrations)
      return result.rows.map((row) => ({
        id: row.id as string,
        description: row.description as string,
        applied_at: row.applied_at as string,
        execution_time: row.execution_time as number,
        checksum: row.checksum as string
      }))
    } catch (error) {
      // If migrations table doesn't exist yet, return empty array
      if ((error as Error).message.includes('no such table: migrations')) {
        return []
      }
      throw error
    }
  }

  /**
   * Run a single migration with transaction support
   */
  private async runMigrationWithTransaction(migration: Migration): Promise<MigrationResult> {
    const startTime = Date.now()

    try {
      await this.db.execute('BEGIN TRANSACTION')

      try {
        // Execute migration statements
        for (const statement of migration.up) {
          await this.db.execute(statement)
        }

        // Record migration in tracking table
        const checksum = this.calculateChecksum(migration)
        const executionTime = Date.now() - startTime

        await this.db.execute({
          sql: MigrationSchema.recordMigrationApplied,
          args: [migration.id, migration.description, new Date().toISOString(), executionTime, checksum]
        })

        await this.db.execute('COMMIT')

        logger.info(`Migration ${migration.id} applied successfully in ${executionTime}ms`)

        return {
          migration,
          success: true,
          executedAt: new Date(),
          executionTime
        }
      } catch (error) {
        await this.db.execute('ROLLBACK')
        throw error
      }
    } catch (error) {
      const executionTime = Date.now() - startTime
      const errorMessage = `Migration ${migration.id} failed: ${(error as Error).message}`

      logger.error(errorMessage, error as Error)

      return {
        migration,
        success: false,
        error: errorMessage,
        executedAt: new Date(),
        executionTime
      }
    }
  }

  /**
   * Run a single migration without transaction
   */
  private async runMigration(migration: Migration): Promise<MigrationResult> {
    const startTime = Date.now()

    try {
      // Execute migration statements
      for (const statement of migration.up) {
        await this.db.execute(statement)
      }

      // Record migration in tracking table
      const checksum = this.calculateChecksum(migration)
      const executionTime = Date.now() - startTime

      await this.db.execute({
        sql: MigrationSchema.recordMigrationApplied,
        args: [migration.id, migration.description, new Date().toISOString(), executionTime, checksum]
      })

      logger.info(`Migration ${migration.id} applied successfully in ${executionTime}ms`)

      return {
        migration,
        success: true,
        executedAt: new Date(),
        executionTime
      }
    } catch (error) {
      const executionTime = Date.now() - startTime
      const errorMessage = `Migration ${migration.id} failed: ${(error as Error).message}`

      logger.error(errorMessage, error as Error)

      return {
        migration,
        success: false,
        error: errorMessage,
        executedAt: new Date(),
        executionTime
      }
    }
  }

  /**
   * Run a rollback migration
   */
  private async runRollback(migration: Migration): Promise<MigrationResult> {
    const startTime = Date.now()

    try {
      await this.db.execute('BEGIN TRANSACTION')

      try {
        // Execute rollback statements
        for (const statement of migration.down!) {
          await this.db.execute(statement)
        }

        // Remove migration record
        await this.db.execute({
          sql: MigrationSchema.removeMigrationRecord,
          args: [migration.id]
        })

        await this.db.execute('COMMIT')

        const executionTime = Date.now() - startTime
        logger.info(`Migration ${migration.id} rolled back successfully in ${executionTime}ms`)

        return {
          migration,
          success: true,
          executedAt: new Date(),
          executionTime
        }
      } catch (error) {
        await this.db.execute('ROLLBACK')
        throw error
      }
    } catch (error) {
      const executionTime = Date.now() - startTime
      const errorMessage = `Rollback of migration ${migration.id} failed: ${(error as Error).message}`

      logger.error(errorMessage, error as Error)

      return {
        migration,
        success: false,
        error: errorMessage,
        executedAt: new Date(),
        executionTime
      }
    }
  }

  /**
   * Calculate checksum for a migration to ensure integrity
   */
  private calculateChecksum(migration: Migration): string {
    const content = JSON.stringify({
      id: migration.id,
      description: migration.description,
      up: migration.up,
      down: migration.down || []
    })
    return crypto.createHash('sha256').update(content).digest('hex')
  }
}
