import { type ProviderEdition, ProviderEditionSchema } from '../schemas/provider'

const ALL_EDITIONS = ProviderEditionSchema.options
const GLOBAL_ONLY_EDITIONS = ['global'] as const satisfies readonly ProviderEdition[]

// Presets removed from the current catalog can still exist in migrated user data.
export const LEGACY_PROVIDER_AVAILABLE_IN_EDITIONS = {
  github: GLOBAL_ONLY_EDITIONS,
  yi: ALL_EDITIONS,
  infini: ALL_EDITIONS,
  hyperbolic: GLOBAL_ONLY_EDITIONS,
  hunyuan: ALL_EDITIONS,
  'tencent-cloud-ti': ALL_EDITIONS,
  'gitee-ai': ALL_EDITIONS
} as const satisfies Record<string, readonly ProviderEdition[]>

export function findLegacyProviderAvailableInEditions(providerId: string): ProviderEdition[] | undefined {
  const availableInEditions =
    LEGACY_PROVIDER_AVAILABLE_IN_EDITIONS[providerId as keyof typeof LEGACY_PROVIDER_AVAILABLE_IN_EDITIONS]

  return availableInEditions ? [...availableInEditions] : undefined
}
