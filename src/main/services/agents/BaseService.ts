import { Client, createClient } from '@libsql/client'
import { loggerService } from '@logger'
import { app } from 'electron'
import path from 'path'

import { migrations } from './database/migrations'
import { Migrator } from './database/migrator'

const logger = loggerService.withContext('BaseService')

/**
 * Base service class providing shared database connection and utilities
 * for all agent-related services
 */
export abstract class BaseService {
  protected static db: Client | null = null
  protected static isInitialized = false

  protected static async initialize(): Promise<void> {
    if (BaseService.isInitialized) {
      return
    }

    try {
      const userDataPath = app.getPath('userData')
      const dbPath = path.join(userDataPath, 'agents.db')

      logger.info(`Initializing Agent database at: ${dbPath}`)

      BaseService.db = createClient({
        url: `file:${dbPath}`
      })

      // Initialize migration system and run migrations
      const migrator = new Migrator(BaseService.db)

      // Register all migrations
      migrator.addMigrations(migrations)

      // Initialize migration tracking table
      await migrator.initialize()

      // Run any pending migrations
      const results = await migrator.migrate()

      if (results.length > 0) {
        const successCount = results.filter((r) => r.success).length
        const failCount = results.length - successCount

        if (failCount > 0) {
          throw new Error(`${failCount} migrations failed during initialization`)
        }

        logger.info(`Successfully applied ${successCount} migrations during initialization`)
      } else {
        logger.info('Database schema is up to date, no migrations needed')
      }

      BaseService.isInitialized = true
      logger.info('Agent database initialized successfully')
    } catch (error) {
      logger.error('Failed to initialize Agent database:', error as Error)
      throw error
    }
  }

  protected ensureInitialized(): void {
    if (!BaseService.isInitialized || !BaseService.db) {
      throw new Error('Database not initialized. Call initialize() first.')
    }
  }

  protected get database(): Client {
    this.ensureInitialized()
    return BaseService.db!
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
