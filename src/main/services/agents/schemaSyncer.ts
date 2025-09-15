import { type Client } from '@libsql/client'
import { loggerService } from '@logger'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import fs from 'fs'
import path from 'path'

import * as schema from './database/schema'

const logger = loggerService.withContext('SchemaSyncer')

export interface MigrationResult {
  success: boolean
  version?: string
  error?: Error
  executionTime?: number
}

/**
 * Simplified database schema synchronization using native Drizzle migrations.
 * This replaces the complex custom MigrationManager with Drizzle's built-in migration system.
 */
export async function syncDatabaseSchema(client: Client): Promise<MigrationResult> {
  const startTime = Date.now()

  try {
    logger.info('Starting database schema synchronization...')

    const db = drizzle(client, { schema })
    const migrationsFolder = path.resolve('./src/main/services/agents/database/drizzle')

    // Check if migrations folder exists
    if (!fs.existsSync(migrationsFolder)) {
      logger.warn('No migrations folder found, skipping migration')
      return {
        success: true,
        version: 'none',
        executionTime: Date.now() - startTime
      }
    }

    // Run migrations using Drizzle's built-in migrator
    await migrate(db, { migrationsFolder })

    const executionTime = Date.now() - startTime
    logger.info(`Database schema synchronized successfully in ${executionTime}ms`)

    return {
      success: true,
      version: 'latest',
      executionTime
    }
  } catch (error) {
    const executionTime = Date.now() - startTime
    logger.error('Schema synchronization failed:', error as Error)
    return {
      success: false,
      error: error as Error,
      executionTime
    }
  }
}

/**
 * Check if database needs initialization (simplified check)
 */
export async function needsInitialization(client: Client): Promise<boolean> {
  try {
    // Simple check - try to query the agents table
    await client.execute('SELECT COUNT(*) FROM agents LIMIT 1')
    return false
  } catch (error) {
    // If query fails, database likely needs initialization
    return true
  }
}

/**
 * Get basic schema information for debugging
 */
export async function getSchemaInfo(client: Client) {
  try {
    // Get list of tables
    const result = await client.execute(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `)

    const tables = result.rows.map((row) => row.name as string)

    return {
      tables,
      status: 'ready'
    }
  } catch (error) {
    logger.error('Failed to get schema info:', error as Error)
    return {
      tables: [],
      status: 'error',
      error: error as Error
    }
  }
}
