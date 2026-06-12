import { loggerService } from '@logger'
import type { UpdateProviderDto } from '@shared/data/api/schemas/providers'
import type { Provider } from '@shared/data/types/provider'

const logger = loggerService.withContext('ProviderSettings:EnableProviderWhenModelsAvailable')

/** Enables a disabled provider once a flow has confirmed it has usable models. */
export async function enableProviderWhenModelsAvailable(
  provider: Pick<Provider, 'id' | 'isEnabled'> | undefined,
  updateProvider: (updates: UpdateProviderDto) => Promise<unknown>,
  modelCount: number,
  source: string
): Promise<boolean> {
  if (!provider || provider.isEnabled || modelCount <= 0) {
    return false
  }

  try {
    await updateProvider({ isEnabled: true })
    return true
  } catch (error) {
    logger.error('Failed to enable provider when models are available', {
      providerId: provider.id,
      modelCount,
      source,
      error
    })
    return false
  }
}
