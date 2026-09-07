import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import type { AppEdition } from '@shared/types/appEdition'

const logger = loggerService.withContext('AppEdition')

let cachedEdition: AppEdition | undefined

export async function preloadAppEdition(): Promise<void> {
  try {
    cachedEdition = (await ipcApi.request('app.get_info')).edition
  } catch (error) {
    cachedEdition = __APP_EDITION__
    logger.warn('Failed to preload runtime app edition; falling back to package edition', error as Error)
  }
}

export function getAppEdition(): AppEdition {
  return cachedEdition ?? __APP_EDITION__
}
