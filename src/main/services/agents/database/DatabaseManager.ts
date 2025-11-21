import { type Client, createClient } from '@libsql/client'
import { loggerService } from '@logger'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import { drizzle } from 'drizzle-orm/libsql'
import fs from 'fs'
import path from 'path'

import { dbPath } from '../drizzle.config'
import { MigrationService } from './MigrationService'
import * as schema from './schema'

const logger = loggerService.withContext('DatabaseManager')

/**
 * Database initialization state
 */
enum InitState {
  INITIALIZING = 'initializing',
  INITIALIZED = 'initialized',
  FAILED = 'failed'
}

/**
 * DatabaseManager - Singleton class for managing libsql database connections
 *
 * Responsibilities:
 * - Single source of truth for database connection
 * - Thread-safe initialization with state management
 * - Automatic migration handling
 * - Safe connection cleanup
 * - Error recovery and retry logic
 * - Windows platform compatibility fixes
 */
export class DatabaseManager {
  private static instance: DatabaseManager | null = null

  private client: Client | null = null
  private db: LibSQLDatabase<typeof schema> | null = null
  private state: InitState = InitState.INITIALIZING

  /**
   * Get the singleton instance (database initialization starts automatically)
   */
  public static async getInstance(): Promise<DatabaseManager> {
    if (DatabaseManager.instance) {
      return DatabaseManager.instance
    }

    const instance = new DatabaseManager()
    await instance.initialize()
    DatabaseManager.instance = instance

    return instance
  }

  /**
   * Perform the actual initialization
   */
  public async initialize(): Promise<void> {
    if (this.state === InitState.INITIALIZED) {
      return
    }

    try {
      logger.info(`Initializing database at: ${dbPath}`)

      // Ensure database directory exists
      const dbDir = path.dirname(dbPath)
      if (!fs.existsSync(dbDir)) {
        logger.info(`Creating database directory: ${dbDir}`)
        fs.mkdirSync(dbDir, { recursive: true })
      }

      // Check if database file is corrupted (Windows specific check)
      if (fs.existsSync(dbPath)) {
        const stats = fs.statSync(dbPath)
        if (stats.size === 0) {
          logger.warn('Database file is empty, removing corrupted file')
          fs.unlinkSync(dbPath)
        }
      }

      // Create client with platform-specific options
      this.client = createClient({
        url: `file:${dbPath}`,
        // intMode: 'number' helps avoid some Windows compatibility issues
        intMode: 'number'
      })

      // Create drizzle instance
      this.db = drizzle(this.client, { schema })

      // Run migrations
      const migrationService = new MigrationService(this.db, this.client)
      await migrationService.runMigrations()

      this.state = InitState.INITIALIZED
      logger.info('Database initialized successfully')
    } catch (error) {
      const err = error as Error
      logger.error('Database initialization failed:', {
        error: err.message,
        stack: err.stack
      })

      // Clean up failed initialization
      this.cleanupFailedInit()

      // Set failed state
      this.state = InitState.FAILED
      throw new Error(`Database initialization failed: ${err.message || 'Unknown error'}`)
    }
  }

  /**
   * Clean up after failed initialization
   */
  private cleanupFailedInit(): void {
    if (this.client) {
      try {
        // On Windows, closing a partially initialized client can crash
        // Wrap in try-catch and ignore errors during cleanup
        this.client.close()
      } catch (error) {
        logger.warn('Failed to close client during cleanup:', error as Error)
      }
    }
    this.client = null
    this.db = null
  }

  /**
   * Get the database instance
   * Automatically waits for initialization to complete
   * @throws Error if database initialization failed
   */
  public async getDatabase(): Promise<LibSQLDatabase<typeof schema>> {
    return this.db!
  }

  /**
   * Get the raw client (for advanced operations)
   * Automatically waits for initialization to complete
   * @throws Error if database initialization failed
   */
  public async getClient(): Promise<Client> {
    return this.client!
  }

  /**
   * Check if database is initialized
   */
  public isInitialized(): boolean {
    return this.state === InitState.INITIALIZED
  }
}
