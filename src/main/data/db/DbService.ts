import { loggerService } from '@logger'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { app } from 'electron'
import path from 'path'
import { pathToFileURL } from 'url'

import Seeding from './seeding'
import type { DbType } from './types'

const logger = loggerService.withContext('DbService')

const DB_NAME = 'cherrystudio.sqlite'
const MIGRATIONS_BASE_PATH = 'migrations/sqlite-drizzle'

/**
 * Database service managing SQLite connection via Drizzle ORM
 * Implements singleton pattern for centralized database access
 *
 * Features:
 * - Database initialization and connection management
 * - Migration and seeding support
 *
 * @example
 * ```typescript
 * import { dbService } from '@data/db/DbService'
 *
 * // Run migrations
 * await dbService.migrateDb()
 *
 * // Get database instance
 * const db = dbService.getDb()
 * ```
 */
class DbService {
  private static instance: DbService
  private db: DbType
  private isInitialized = false
  private walConfigured = false

  private constructor() {
    try {
      this.db = drizzle({
        connection: { url: pathToFileURL(path.join(app.getPath('userData'), DB_NAME)).href },
        casing: 'snake_case'
      })
      logger.info('Database connection initialized', {
        dbPath: path.join(app.getPath('userData'), DB_NAME)
      })
    } catch (error) {
      logger.error('Failed to initialize database connection', error as Error)
      throw new Error('Database initialization failed')
    }
  }

  /**
   * Get singleton instance of DbService
   * Creates a new instance if one doesn't exist
   * @returns {DbService} The singleton DbService instance
   * @throws {Error} If database initialization fails
   */
  public static getInstance(): DbService {
    if (!DbService.instance) {
      DbService.instance = new DbService()
    }
    return DbService.instance
  }

  /**
   * Initialize the database
   * @throws {Error} If database initialization fails
   */
  public async init(): Promise<void> {
    if (this.isInitialized) {
      logger.warn('Database already initialized, do not need initialize again!')
      return
    }

    try {
      // Configure WAL mode on first database operation
      await this.configureWAL()
      this.isInitialized = true
    } catch (error) {
      logger.error('Database initialization failed', error as Error)
      throw error
    }
  }

  /**
   * Configure WAL mode for better concurrency performance
   * Called once during the first database operation
   */
  private async configureWAL(): Promise<void> {
    if (this.walConfigured) {
      return
    }

    try {
      await this.db.run(sql`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON`)

      this.walConfigured = true
      logger.info('WAL mode configured for database')
    } catch (error) {
      logger.warn('Failed to configure WAL mode, using default journal mode', error as Error)
      // Don't throw error, allow database to continue with default mode
    }
  }

  /**
   * Run database migrations
   * @throws {Error} If migration fails
   */
  public async migrateDb(): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Database is not initialized, please call init() first!')
    }

    try {
      const migrationsFolder = this.getMigrationsFolder()
      await migrate(this.db, { migrationsFolder })

      logger.info('Database migration completed successfully')
    } catch (error) {
      logger.error('Database migration failed', error as Error)
      throw error
    }
  }

  /**
   * Get the database instance
   * @throws {Error} If database is not initialized
   */
  public getDb(): DbType {
    if (!this.isInitialized) {
      throw new Error('Database is not initialized, please call init() first!')
    }
    return this.db
  }

  /**
   * Check if database is initialized
   */
  public isReady(): boolean {
    return this.isInitialized
  }

  /**
   * Run seed data migration
   * @param seedName - Name of the seed to run
   * @throws {Error} If seed migration fails
   */
  public async migrateSeed(seedName: keyof typeof Seeding): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Database is not initialized, please call init() first!')
    }

    try {
      const Seed = Seeding[seedName]
      if (!Seed) {
        throw new Error(`Seed "${seedName}" not found`)
      }

      await new Seed().migrate(this.db)

      logger.info('Seed migration completed successfully', { seedName })
    } catch (error) {
      logger.error('Seed migration failed', error as Error, { seedName })
      throw error
    }
  }

  /**
   * Get the migrations folder based on the app's packaging status
   * @returns The path to the migrations folder
   */
  private getMigrationsFolder(): string {
    if (app.isPackaged) {
      //see electron-builder.yml, extraResources from/to
      return path.join(process.resourcesPath, MIGRATIONS_BASE_PATH)
    } else {
      // in dev/preview, __dirname maybe /out/main
      return path.join(__dirname, '../../', MIGRATIONS_BASE_PATH)
    }
  }
}

// Export a singleton instance
export const dbService = DbService.getInstance()
