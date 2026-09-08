import type { ProviderConfig } from '../../types'
import type { VendorBag } from '../../utils/imageOptions'
import { dmxapiUsesCustomTransport } from './dmxapi/dmxapiImageRouting'
import type { ImageGenerationTransport, ImageTransportDescriptor } from './imageGenerationModel'

const TRANSPORT_SUPPORT = {
  ppio: { requiresDescriptor: true, supports: () => true },
  dashscope: { requiresDescriptor: true, supports: () => true },
  modelscope: { requiresDescriptor: false, supports: () => true },
  dmxapi: { requiresDescriptor: false, supports: dmxapiUsesCustomTransport },
  tokenhub: { requiresDescriptor: true, supports: () => true }
}

export type ImageTransportProviderId = keyof typeof TRANSPORT_SUPPORT

const TRANSPORT_PROVIDER_IDS: ReadonlySet<string> = new Set(Object.keys(TRANSPORT_SUPPORT))

function isImageTransportProviderId(providerId: string): providerId is ImageTransportProviderId {
  return TRANSPORT_PROVIDER_IDS.has(providerId)
}

export function requiresImageTransportDescriptor(providerId: string): boolean {
  return isImageTransportProviderId(providerId) && TRANSPORT_SUPPORT[providerId].requiresDescriptor
}

export function hasImageTransport(
  providerId: string,
  modelId: string,
  modelDescriptor?: ImageTransportDescriptor
): providerId is ImageTransportProviderId {
  if (!isImageTransportProviderId(providerId)) return false
  const support = TRANSPORT_SUPPORT[providerId]
  return support.supports(modelId) && (!support.requiresDescriptor || modelDescriptor !== undefined)
}

export function isImageTransportConfig(
  config: ProviderConfig,
  modelId: string,
  modelDescriptor?: ImageTransportDescriptor
): config is ProviderConfig<ImageTransportProviderId> {
  return hasImageTransport(config.providerId, modelId, modelDescriptor)
}

export async function resolveImageTransport(
  config: ProviderConfig<ImageTransportProviderId>,
  modelId: string,
  modelDescriptor?: ImageTransportDescriptor
): Promise<ImageGenerationTransport<VendorBag> | null> {
  if (!hasImageTransport(config.providerId, modelId, modelDescriptor)) return null

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
