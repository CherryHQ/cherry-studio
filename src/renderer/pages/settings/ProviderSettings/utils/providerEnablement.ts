import { loggerService } from '@logger'
import type { UpdateProviderDto } from '@shared/data/api/schemas/providers'
import type { Provider } from '@shared/data/types/provider'

const logger = loggerService.withContext('ProviderSettings:EnableProviderWhenModelsAvailable')

export interface ProviderReorderActions {
  assertCanMoveProviderToFirst: () => void
  moveProviderToFirst: (providerId: Provider['id']) => Promise<unknown>
}

/** Enables a disabled provider once a flow has confirmed it has usable models, then moves it to the top. */
export async function enableProviderWhenModelsAvailable(
  provider: Pick<Provider, 'id' | 'isEnabled'> | undefined,
  updateProvider: (updates: UpdateProviderDto) => Promise<unknown>,
  providerReorder: ProviderReorderActions,
  modelCount: number,
  source: string
): Promise<boolean> {
  if (!provider || provider.isEnabled || modelCount <= 0) {
    return false
  }

  try {
    providerReorder.assertCanMoveProviderToFirst()
  } catch (error) {
    logger.error('Provider list is not ready for enabling with pin-to-top', {
      providerId: provider.id,
      modelCount,
      source,
      error
    })
    return false
  }

  try {
    await updateProvider({ isEnabled: true })
  } catch (error) {
    logger.error('Failed to enable provider when models are available', {
      providerId: provider.id,
      modelCount,
      source,
      error
    })
    return false
  }

  try {
    await providerReorder.moveProviderToFirst(provider.id)
    return true
  } catch (error) {
    logger.error('Failed to move enabled provider to the top', {
      providerId: provider.id,
      modelCount,
      source,
      error
    })
    return false
  }
}
