import data from '../data/provider-models.json'
import type { ModelSnapshot } from './registry'
import { ProviderModelListSchema } from './schemas/provider-models'

export const bundledProviderModels: ModelSnapshot['providerModels'] = ProviderModelListSchema.parse(data)
