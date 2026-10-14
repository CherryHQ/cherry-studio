import type { EndpointType } from '../schemas/enums'
import type { RegistryEndpointConfig } from '../schemas/provider'
import type { ProviderModelOverride } from '../schemas/provider-models'

interface ServiceTierCatalogProvider {
  id: string
  defaultChatEndpoint?: EndpointType | null
  endpointConfigs?: Partial<Record<EndpointType, RegistryEndpointConfig>>
}

export function getServiceTierCatalogErrors(
  providers: readonly ServiceTierCatalogProvider[],
  overrides: readonly ProviderModelOverride[]
): string[] {
  const providerById = new Map(providers.map((provider) => [provider.id, provider]))
  const errors: string[] = []

  for (const override of overrides) {
    const options = override.requestControls?.serviceTier?.options
    if (!options) continue

    const provider = providerById.get(override.providerId)
    const endpointTypes = override.endpointTypes?.length
      ? override.endpointTypes
      : provider?.defaultChatEndpoint
        ? [provider.defaultChatEndpoint]
        : []
    const controls = endpointTypes.flatMap((endpointType) => {
      const control = provider?.endpointConfigs?.[endpointType]?.requestControls?.serviceTier
      return control ? [{ endpointType, control }] : []
    })

    if (controls.length === 0) {
      errors.push(`${override.providerId}/${override.modelId}: service tier override has no endpoint control`)
      continue
    }

    for (const { endpointType, control } of controls) {
      for (const option of options) {
        if (!control.wire.values[option]) {
          errors.push(`${override.providerId}/${override.modelId}@${endpointType}: missing wire value for '${option}'`)
        }
      }
    }
  }

  return errors
}
