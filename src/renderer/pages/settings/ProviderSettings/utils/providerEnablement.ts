import { loggerService } from '@logger'
import type { Provider } from '@shared/data/types/provider'

const logger = loggerService.withContext('ProviderSettings:EnableProviderWhenModelsAvailable')

/** Enables a disabled provider once a flow has confirmed it has usable models, then moves it to the top. */
export async function enableProviderWhenModelsAvailable(
  provider: Pick<Provider, 'id' | 'isEnabled'> | undefined,
  enableProvider: () => Promise<unknown>,
  modelCount: number,
  source: string
): Promise<void> {
  if (!provider || provider.isEnabled || modelCount <= 0) {
    return
  }

  try {
    await enableProvider()
  } catch (error) {
    logger.error('Failed to enable provider with pin-to-top when models are available', {
      providerId: provider.id,
      modelCount,
      source,
      error
    })
    throw error
  }
}
