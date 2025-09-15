import { type Client, createClient } from '@libsql/client'
import { loggerService } from '@logger'
import { drizzle } from 'drizzle-orm/libsql'
import fs from 'fs'
import path from 'path'

import * as schema from './database/schema'
import { dbPath } from './drizzle.config'
import { getSchemaInfo, needsInitialization, syncDatabaseSchema } from './schemaSyncer'

const logger = loggerService.withContext('BaseService')

/**
 * Base service class providing shared database connection and utilities
 * for all agent-related services.
 *
 * Features:
 * - Programmatic schema management (no CLI dependencies)
 * - Automatic table creation and migration
 * - Schema version tracking and compatibility checks
 * - Transaction-based operations for safety
 * - Development vs production mode handling
 * - Connection retry logic with exponential backoff
 */
export abstract class BaseService {
  protected static client: Client | null = null
  protected static db: ReturnType<typeof drizzle> | null = null
  protected static isInitialized = false
  protected static initializationPromise: Promise<void> | null = null

  /**
   * Initialize database with retry logic and proper error handling
   */
  protected static async initialize(): Promise<void> {
    // Return existing initialization if in progress
    if (BaseService.initializationPromise) {
      return BaseService.initializationPromise
    }

    if (BaseService.isInitialized) {
      return
    }

    BaseService.initializationPromise = BaseService.performInitialization()
    return BaseService.initializationPromise
  }

  private static async performInitialization(): Promise<void> {
    const maxRetries = 3
    let lastError: Error

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info(`Initializing Agent database at: ${dbPath} (attempt ${attempt}/${maxRetries})`)

        // Ensure the database directory exists
        const dbDir = path.dirname(dbPath)
        if (!fs.existsSync(dbDir)) {
          logger.info(`Creating database directory: ${dbDir}`)
          fs.mkdirSync(dbDir, { recursive: true })
        }

        BaseService.client = createClient({
          url: `file:${dbPath}`
        })

        BaseService.db = drizzle(BaseService.client, { schema })

        // Auto-sync database schema on startup
        const result = await syncDatabaseSchema(BaseService.client)

        if (!result.success) {
          throw result.error || new Error('Schema synchronization failed')
        }

        BaseService.isInitialized = true
        logger.info(`Agent database initialized successfully (version: ${result.version})`)
        return
      } catch (error) {
        lastError = error as Error
        logger.warn(`Database initialization attempt ${attempt} failed:`, lastError)

        // Clean up on failure
        if (BaseService.client) {
          try {
            BaseService.client.close()
          } catch (closeError) {
            logger.warn('Failed to close client during cleanup:', closeError as Error)
          }
        }
        BaseService.client = null
        BaseService.db = null

        // Wait before retrying (exponential backoff)
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000 // 2s, 4s, 8s
          logger.info(`Retrying in ${delay}ms...`)
          await new Promise((resolve) => setTimeout(resolve, delay))
        }
      }
    }

    // All retries failed
    BaseService.initializationPromise = null
    logger.error('Failed to initialize Agent database after all retries:', lastError!)
    throw lastError!
  }

  protected ensureInitialized(): void {
    if (!BaseService.isInitialized || !BaseService.db || !BaseService.client) {
      throw new Error('Database not initialized. Call initialize() first.')
    }
  }

  protected get database(): ReturnType<typeof drizzle> {
    this.ensureInitialized()
    return BaseService.db!
  }

  protected get rawClient(): Client {
    this.ensureInitialized()
    return BaseService.client!
  }

  protected serializeJsonFields(data: any): any {
    const serialized = { ...data }
    const jsonFields = ['built_in_tools', 'mcps', 'knowledges', 'configuration', 'accessible_paths', 'sub_agent_ids']

    for (const field of jsonFields) {
      if (serialized[field] !== undefined) {
        serialized[field] =
          Array.isArray(serialized[field]) || typeof serialized[field] === 'object'
            ? JSON.stringify(serialized[field])
            : serialized[field]
      }
    }

    return serialized
  }

  protected deserializeJsonFields(data: any): any {
    if (!data) return data

    const deserialized = { ...data }
    const jsonFields = ['built_in_tools', 'mcps', 'knowledges', 'configuration', 'accessible_paths', 'sub_agent_ids']

    for (const field of jsonFields) {
      if (deserialized[field] && typeof deserialized[field] === 'string') {
        try {
          deserialized[field] = JSON.parse(deserialized[field])
        } catch (error) {
          logger.warn(`Failed to parse JSON field ${field}:`, error as Error)
        }
      }
    }

    return deserialized
  }

  /**
   * Check if database is healthy and initialized
   */
  static async healthCheck(): Promise<{
    isHealthy: boolean
    version?: string
    error?: string
  }> {
    try {
      if (!BaseService.isInitialized || !BaseService.client) {
        return { isHealthy: false, error: 'Database not initialized' }
      }

      const schemaInfo = await getSchemaInfo(BaseService.client)
      if (!schemaInfo) {
        return { isHealthy: false, error: 'Failed to get schema info' }
      }

      return {
        isHealthy: true,
        version: schemaInfo.status === 'ready' ? 'latest' : 'unknown'
      }
    } catch (error) {
      return {
        isHealthy: false,
        error: (error as Error).message
      }
    }
  }

  /**
   * Get database status for debugging
   */
  static async getStatus() {
    try {
      if (!BaseService.client) {
        return { status: 'not_initialized' }
      }

      const schemaInfo = await getSchemaInfo(BaseService.client)
      const needsInit = await needsInitialization(BaseService.client)

      return {
        status: BaseService.isInitialized ? 'initialized' : 'initializing',
        needsInitialization: needsInit,
        schemaInfo
      }
    } catch (error) {
      return {
        status: 'error',
        error: (error as Error).message
      }
    }
  }

  /**
   * Force re-initialization (for development/testing)
   */
  static async reinitialize(): Promise<void> {
    BaseService.isInitialized = false
    BaseService.initializationPromise = null

    if (BaseService.client) {
      try {
        BaseService.client.close()
      } catch (error) {
        logger.warn('Failed to close client during reinitialize:', error as Error)
      }
    }

    BaseService.client = null
    BaseService.db = null

    await BaseService.initialize()
  }
}
