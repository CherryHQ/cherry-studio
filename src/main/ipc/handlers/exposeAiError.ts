import { loggerService } from '@logger'
import { serializeError } from '@main/ai/utils/serializeError'
import { aiErrorCodes } from '@shared/ipc/errors/ai'
import { IpcError } from '@shared/ipc/errors/IpcError'

const logger = loggerService.withContext('ipc/ai')

export async function exposeAiError<T>(route: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    const serializedError = serializeError(error)
    if (!(error instanceof Error && error.name === 'AbortError')) {
      logger.error(`${route} failed`, serializedError)
    }
    throw new IpcError(aiErrorCodes.AI_REQUEST_FAILED, serializedError.message ?? '', serializedError)
  }
}
