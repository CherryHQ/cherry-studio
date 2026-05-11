import { application } from '@application'
import { RegistryLoader } from '@cherrystudio/provider-registry/node'
import { loggerService } from '@logger'
import type { ProviderWebsites } from '@shared/data/types/provider'

const logger = loggerService.withContext('DataApi:ProviderRegistryMetadata')
let loader: RegistryLoader | null = null

function getLoader(): RegistryLoader {
  if (!loader) {
    loader = new RegistryLoader({
      models: application.getPath('feature.provider_registry.data', 'models.json'),
      providers: application.getPath('feature.provider_registry.data', 'providers.json'),
      providerModels: application.getPath('feature.provider_registry.data', 'provider-models.json')
    })
  }
  return loader
}

export interface ProviderPresetDisplayMetadata {
  description?: string
  websites?: ProviderWebsites
}

export function getProviderPresetDisplayMetadata(presetProviderId: string): ProviderPresetDisplayMetadata {
  try {
    const registryProvider = getLoader()
      .loadProviders()
      .find((provider) => provider.id === presetProviderId)

    return {
      description: registryProvider?.description,
      websites: registryProvider?.metadata?.website
    }
  } catch (error) {
    logger.warn('Failed to load provider preset display metadata', { presetProviderId, error })
    return {}
  }
}

export function clearProviderPresetDisplayMetadataCache(): void {
  loader = null
}
