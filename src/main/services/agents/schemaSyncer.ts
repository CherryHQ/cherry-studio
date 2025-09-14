import { execSync } from 'child_process'
import { loggerService } from '@logger'
import path from 'path'

const logger = loggerService.withContext('SchemaSyncer')

/**
 * Synchronizes database schema using Drizzle Kit push command.
 * This automatically detects schema differences and applies necessary changes.
 *
 * Uses the existing drizzle.config.ts configuration to push schema changes
 * to the agents database on service startup.
 */
export async function syncDatabaseSchema(): Promise<void> {
  const configPath = path.join(process.cwd(), 'src/main/services/agents/drizzle.config.ts')

  try {
    logger.info('Starting database schema synchronization...')

    // Use drizzle-kit push to sync schema automatically
    const output = execSync(`npx drizzle-kit push --config ${configPath}`, {
      stdio: 'pipe',
      encoding: 'utf-8',
      cwd: process.cwd(),
      timeout: 30000 // 30 second timeout
    })

    logger.info('Database schema synchronized successfully')

    // Log output for debugging if needed
    if (output && output.trim()) {
      logger.debug('Drizzle Kit output:', output.trim())
    }

  } catch (error) {
    logger.error('Schema synchronization failed:', error as Error)
    throw new Error(`Database schema sync failed: ${(error as Error).message}`)
  }
}