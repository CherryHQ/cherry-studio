import { type Client, createClient } from '@libsql/client'
import { loggerService } from '@logger'
import { drizzle } from 'drizzle-orm/libsql'
import { app } from 'electron'
import path from 'path'

import * as schema from './database/schema'

const logger = loggerService.withContext('BaseService')

/**
 * Base service class providing shared database connection and utilities
 * for all agent-related services.
 *
 * Uses a migration-only approach for database schema management.
 * The database schema is defined and maintained exclusively through
 * migration files, ensuring a single source of truth.
 */
export abstract class BaseService {
  protected static client: Client | null = null
  protected static db: ReturnType<typeof drizzle> | null = null
  protected static isInitialized = false

  protected static async initialize(): Promise<void> {
    if (BaseService.isInitialized) {
      return
    }

    try {
      const userDataPath = app.getPath('userData')
      const dbPath = path.join(userDataPath, 'agents.db')

      logger.info(`Initializing Agent database at: ${dbPath}`)

      BaseService.client = createClient({
        url: `file:${dbPath}`
      })

      BaseService.db = drizzle(BaseService.client, { schema })

      // For new development, tables will be created by Drizzle Kit migrations
      // or can be created programmatically as needed

      BaseService.isInitialized = true
      logger.info('Agent database initialized successfully')
    } catch (error) {
      logger.error('Failed to initialize Agent database:', error as Error)
      throw error
    }
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
}
