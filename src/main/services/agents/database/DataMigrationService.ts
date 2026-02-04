/**
 * Data Migration Service
 *
 * Handles data migrations (not schema changes) that require code logic.
 * These migrations are tracked in the migrations table with a 'data_' prefix.
 */

import type { Client } from '@libsql/client'
import { loggerService } from '@logger'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'

import type * as schema from './schema'
import { migrations, type NewMigration } from './schema/migrations.schema'

const logger = loggerService.withContext('DataMigrationService')

export interface DataMigration {
  version: number
  tag: string
  description: string
  migrate: (db: LibSQLDatabase<typeof schema>) => Promise<void>
}

/**
 * Registry of all data migrations.
 * Add new migrations here with incrementing version numbers starting at 10000
 * to avoid conflicts with schema migrations.
 *
 * Note: Migrations receive the db instance to avoid circular dependency with DatabaseManager.
 */
const DATA_MIGRATIONS: DataMigration[] = [
  {
    version: 10001,
    tag: 'data_0001_fix_block_references',
    description: 'Fix missing block IDs in message.blocks array',
    migrate: async (db) => {
      // Dynamic import to avoid circular dependency
      const { runBlockReferencesMigration } = await import('./migrateBlockReferences')
      const result = await runBlockReferencesMigration(db)
      logger.info('Block references migration result', {
        totalMessages: result.totalMessages,
        messagesFixed: result.messagesFixed,
        blockReferencesAdded: result.blockReferencesAdded,
        errors: result.errors.length
      })
      if (result.errors.length > 0) {
        logger.warn('Some messages failed to migrate', { errors: result.errors })
      }
    }
  }
]

export class DataMigrationService {
  private db: LibSQLDatabase<typeof schema>
  private client: Client

  constructor(db: LibSQLDatabase<typeof schema>, client: Client) {
    this.db = db
    this.client = client
  }

  async runDataMigrations(): Promise<void> {
    try {
      logger.info('Starting data migration check...')

      // Ensure migrations table exists
      const hasMigrationsTable = await this.migrationsTableExists()
      if (!hasMigrationsTable) {
        logger.info('Migrations table not found, skipping data migrations')
        return
      }

      // Get applied migrations
      const appliedMigrations = await this.db.select().from(migrations)
      const appliedVersions = new Set(appliedMigrations.map((m) => Number(m.version)))

      // Find pending data migrations
      const pendingMigrations = DATA_MIGRATIONS.filter((m) => !appliedVersions.has(m.version)).sort(
        (a, b) => a.version - b.version
      )

      if (pendingMigrations.length === 0) {
        logger.info('No pending data migrations')
        return
      }

      logger.info(`Found ${pendingMigrations.length} pending data migrations`)

      // Execute pending migrations
      for (const migration of pendingMigrations) {
        await this.executeMigration(migration)
      }

      logger.info('All data migrations completed successfully')
    } catch (error) {
      logger.error('Data migration failed:', { error })
      throw error
    }
  }

  private async migrationsTableExists(): Promise<boolean> {
    try {
      const table = await this.client.execute(`SELECT name FROM sqlite_master WHERE type='table' AND name='migrations'`)
      return table.rows.length > 0
    } catch (error) {
      logger.error('Failed to check migrations table status:', { error })
      throw error
    }
  }

  private async executeMigration(migration: DataMigration): Promise<void> {
    try {
      logger.info(`Executing data migration ${migration.tag}: ${migration.description}`)
      const startTime = Date.now()

      // Note: If migrate() partially completes and then throws, the migration
      // is NOT recorded as applied. On next startup it will re-run, which is
      // safe because individual migrations are designed to be idempotent.
      await migration.migrate(this.db)

      // Record migration as applied
      const newMigration: NewMigration = {
        version: migration.version,
        tag: migration.tag,
        executedAt: Date.now()
      }

      await this.db.insert(migrations).values(newMigration)

      const executionTime = Date.now() - startTime
      logger.info(`Data migration ${migration.tag} completed in ${executionTime}ms`)
    } catch (error) {
      logger.error(`Data migration ${migration.tag} failed:`, { error })
      throw error
    }
  }
}
