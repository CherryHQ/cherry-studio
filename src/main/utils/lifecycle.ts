import { loggerService } from '@logger'

import { DatabaseManager } from '../services/agents/database/DatabaseManager'
import { fileStorage } from '../services/FileStorage'

const logger = loggerService.withContext('Lifecycle')

/**
 * Close all data-layer connections and file watchers.
 * Must be called before deleting or replacing the Data/ directory
 * to avoid EBUSY on Windows.
 */
export async function closeAllDataConnections(): Promise<void> {
  const results = await Promise.allSettled([DatabaseManager.close(), fileStorage.stopFileWatcher()])

  const labels = ['DatabaseManager', 'FileWatcher']
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'rejected') {
      logger.warn(`Failed to close ${labels[i]}`, (results[i] as PromiseRejectedResult).reason as Error)
    }
  }
}
