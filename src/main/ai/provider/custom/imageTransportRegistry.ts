import type { ProviderConfig } from '../../types'
import type { VendorBag } from '../../utils/imageOptions'
import { dmxapiUsesCustomTransport } from './dmxapi/dmxapiImageRouting'
import type { ImageGenerationTransport } from './imageGenerationModel'

const TRANSPORT_SUPPORT = {
  ppio: () => true,
  dashscope: () => true,
  modelscope: () => true,
  dmxapi: dmxapiUsesCustomTransport,
  tokenhub: () => true
}

export type ImageTransportProviderId = keyof typeof TRANSPORT_SUPPORT

const TRANSPORT_PROVIDER_IDS: ReadonlySet<string> = new Set(Object.keys(TRANSPORT_SUPPORT))

function isImageTransportProviderId(providerId: string): providerId is ImageTransportProviderId {
  return TRANSPORT_PROVIDER_IDS.has(providerId)
}

export function hasImageTransport(providerId: string, modelId: string): providerId is ImageTransportProviderId {
  return isImageTransportProviderId(providerId) && TRANSPORT_SUPPORT[providerId](modelId)
}

export function isImageTransportConfig(
  config: ProviderConfig,
  modelId: string
): config is ProviderConfig<ImageTransportProviderId> {
  return hasImageTransport(config.providerId, modelId)
}

export async function resolveImageTransport(
  config: ProviderConfig<ImageTransportProviderId>,
  modelId: string
): Promise<ImageGenerationTransport<VendorBag> | null> {
  if (!TRANSPORT_SUPPORT[config.providerId](modelId)) return null

  switch (config.providerId) {
    case 'ppio': {
      const { buildPpioTransport } = await import('./ppio/ppioProvider')
      return buildPpioTransport(config.providerSettings)
    }
    case 'dashscope': {
      const { buildDashScopeTransport } = await import('./dashscope/dashscopeProvider')
      return buildDashScopeTransport(config.providerSettings)
    }
    case 'modelscope': {
      const { buildModelscopeTransport } = await import('./modelscope/modelscopeProvider')
      return buildModelscopeTransport(config.providerSettings)
    }
    case 'dmxapi': {
      const { buildDmxapiTransport } = await import('./dmxapi/dmxapiProvider')
      return buildDmxapiTransport(config.providerSettings)
    }
    case 'tokenhub': {
      const { buildTokenhubTransport } = await import('./tokenhub/tokenhubProvider')
      return buildTokenhubTransport(config.providerSettings)
    }
  }
}
