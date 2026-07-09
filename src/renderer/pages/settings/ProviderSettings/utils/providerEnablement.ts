import { loggerService } from '@logger'
import type { Provider } from '@shared/data/types/provider'

const logger = loggerService.withContext('ProviderSettings:EnableProviderWhenModelsAvailable')

export type ProviderEnablementResult =
  | { status: 'skipped'; reason: 'missing_provider' | 'already_enabled' | 'no_models' }
  | { status: 'enabled' }
  | { status: 'failed'; error: unknown }

function getSkippedResult(
  provider: Pick<Provider, 'id' | 'isEnabled'> | undefined,
  modelCount: number
): ProviderEnablementResult | null {
  if (!provider) {
    return { status: 'skipped', reason: 'missing_provider' }
  }
  if (provider.isEnabled) {
    return { status: 'skipped', reason: 'already_enabled' }
  }
  if (modelCount <= 0) {
    return { status: 'skipped', reason: 'no_models' }
  }
  return null
}

/** Enables a disabled provider once a flow has confirmed it has usable models, then moves it to the top. */
export async function enableProviderWhenModelsAvailable(
  provider: Pick<Provider, 'id' | 'isEnabled'> | undefined,
  enableProviderAndMoveToFirst: () => Promise<unknown>,
  modelCount: number,
  source: string
): Promise<ProviderEnablementResult> {
  const skipped = getSkippedResult(provider, modelCount)
  if (skipped) {
    return skipped
  }
  if (!provider) {
    return { status: 'skipped', reason: 'missing_provider' }
  }

  try {
    await enableProviderAndMoveToFirst()
    return { status: 'enabled' }
  } catch (error) {
    logger.error('Failed to enable provider with pin-to-top when models are available', {
      providerId: provider.id,
      modelCount,
      source,
      error
    })
    return { status: 'failed', error }
  }
}
