import { loggerService } from '@logger'
import { initializeSharedProviders, SHARED_PROVIDER_CONFIGS } from '@shared/provider'

const logger = loggerService.withContext('ProviderConfigs')

export const NEW_PROVIDER_CONFIGS = SHARED_PROVIDER_CONFIGS

export async function initializeNewProviders(): Promise<void> {
  initializeSharedProviders({
    warn: (message) => logger.warn(message),
    error: (message, error) => logger.error(message, error)
  })
}
