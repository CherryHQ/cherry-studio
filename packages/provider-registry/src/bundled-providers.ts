import data from '../data/providers.json'
import type { RegistryCatalog } from './registry'
import { ProviderListSchema } from './schemas/provider'

export const bundledProviders: RegistryCatalog['providers'] = ProviderListSchema.parse(data)
