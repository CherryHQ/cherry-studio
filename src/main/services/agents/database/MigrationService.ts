import { type Client } from '@libsql/client'
import { loggerService } from '@logger'
import { getResourcePath } from '@main/utils'
import { type LibSQLDatabase } from 'drizzle-orm/libsql'
import fs from 'fs'
import path from 'path'

import * as schema from './schema'
import { migrations, type NewMigration } from './schema/migrations.schema'

const logger = loggerService.withContext('MigrationService')

interface MigrationJournal {
  version: string
  dialect: string
  entries: Array<{
    idx: number
    version: string
    when: number
    tag: string
    breakpoints: boolean
  }>
}

export class MigrationService {
  private db: LibSQLDatabase<typeof schema>
  private client: Client
  private migrationDir: string

  constructor(db: LibSQLDatabase<typeof schema>, client: Client) {
    this.db = db
    this.client = client
    this.migrationDir = path.join(getResourcePath(), 'database', 'drizzle')
  }

  async runMigrations(): Promise<void> {
    try {
      logger.info('Starting migration check...')

      const hasMigrationsTable = await this.migrationsTableExists()

      if (!hasMigrationsTable) {
        logger.info('Migrations table not found; assuming fresh database state')
      }

      // Read migration journal
      const journal = await this.readMigrationJournal()
      if (!journal.entries.length) {
        logger.info('No migrations found in journal')
        return
      }

      // Get applied migrations
      const appliedMigrations = hasMigrationsTable ? await this.getAppliedMigrations() : []
      const appliedVersions = new Set(appliedMigrations.map((m) => Number(m.version)))

      const latestAppliedVersion = appliedMigrations.reduce(
        (max, migration) => Math.max(max, Number(migration.version)),
        0
      )
      const latestJournalVersion = journal.entries.reduce((max, entry) => Math.max(max, entry.idx), 0)

      logger.info(`Latest applied migration: v${latestAppliedVersion}, latest available: v${latestJournalVersion}`)

      // Find pending migrations (compare journal idx with stored version, which is the same value)
      const pendingMigrations = journal.entries
        .filter((entry) => !appliedVersions.has(entry.idx))
        .sort((a, b) => a.idx - b.idx)

      if (pendingMigrations.length === 0) {
        logger.info('Database is up to date')
        return
      }

      logger.info(`Found ${pendingMigrations.length} pending migrations`)

      // Execute pending migrations
      for (const migration of pendingMigrations) {
        await this.executeMigration(migration)
      }

      logger.info('All migrations completed successfully')
    } catch (error) {
      logger.error('Migration failed:', { error })
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

  private async readMigrationJournal(): Promise<MigrationJournal> {
    const journalPath = path.join(this.migrationDir, 'meta', '_journal.json')

    if (!fs.existsSync(journalPath)) {
      logger.warn('Migration journal not found:', { journalPath })
      return { version: '7', dialect: 'sqlite', entries: [] }
    }

    try {
      const journalContent = fs.readFileSync(journalPath, 'utf-8')
      return JSON.parse(journalContent)
    } catch (error) {
      logger.error('Failed to read migration journal:', { error })
      throw error
    }
  }

  private async getAppliedMigrations(): Promise<schema.Migration[]> {
    try {
      return await this.db.select().from(migrations)
    } catch (error) {
      // This should not happen since we ensure the table exists in runMigrations()
      logger.error('Failed to query applied migrations:', { error })
      throw error
    }
  }

  private async executeMigration(migration: MigrationJournal['entries'][0]): Promise<void> {
    const sqlFilePath = path.join(this.migrationDir, `${migration.tag}.sql`)

    if (!fs.existsSync(sqlFilePath)) {
      throw new Error(`Migration SQL file not found: ${sqlFilePath}`)
    }

    try {
      logger.info(`Executing migration ${migration.tag}...`)
      const startTime = Date.now()

      // Read and execute SQL
      const sqlContent = fs.readFileSync(sqlFilePath, 'utf-8')
      await this.client.executeMultiple(sqlContent)

      // Record migration as applied (store journal idx as version for tracking)
      const newMigration: NewMigration = {
        version: migration.idx,
        tag: migration.tag,
        executedAt: Date.now()
      }

      if (!(await this.migrationsTableExists())) {
        throw new Error('Migrations table missing after executing migration; cannot record progress')
      }

      await this.db.insert(migrations).values(newMigration)

      const executionTime = Date.now() - startTime
      logger.info(`Migration ${migration.tag} completed in ${executionTime}ms`)
    } catch (error) {
      logger.error(`Migration ${migration.tag} failed:`, { error })
      throw error
    }
  }
}
