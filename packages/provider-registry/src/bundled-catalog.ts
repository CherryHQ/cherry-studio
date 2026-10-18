import { bundledModels } from './bundled-models'
import { bundledProviderModels } from './bundled-provider-models'
import { bundledProviders } from './bundled-providers'
import type { RegistryCatalog } from './registry'

export const bundledCatalog: RegistryCatalog = {
  models: bundledModels,
  providers: bundledProviders,
  providerModels: bundledProviderModels
}
