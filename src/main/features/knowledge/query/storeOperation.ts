import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api/errors'

import type { KnowledgeIndexStore } from '../pipeline/vectorstore/indexStore/KnowledgeIndexStore'

const logger = loggerService.withContext('Knowledge:Query')

/**
 * Run a per-base index-store interaction, translating the error raised when the
 * store is closed mid-flight — a concurrent `deleteBase` or app shutdown
 * closed the driver — into a defined, retryable DataApiError instead of leaking
 * the opaque driver-level error to the renderer. Genuine query errors rethrow
 * unchanged.
 */
export async function runStoreOperation<T>(
  store: KnowledgeIndexStore,
  baseId: string,
  operation: string,
  run: () => T | Promise<T>
): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (store.isClosed()) {
      logger.warn('Knowledge index store was closed during operation', { baseId, operation })
      throw DataApiErrorFactory.invalidOperation(
        operation,
        `Knowledge base '${baseId}' index store was closed during ${operation}; retry the operation`
      )
    }
    throw error
  }
}
