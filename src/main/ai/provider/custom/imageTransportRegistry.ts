import type { VendorBag } from '../../utils/imageOptions'
import type { ImageGenerationTransport } from './imageGenerationModel'
import { dmxapiUsesCustomTransport } from './dmxapi/dmxapiImageRouting'

interface TransportRegistration {
  supports: (modelId: string) => boolean
  load: (providerSettings: unknown) => Promise<ImageGenerationTransport<VendorBag>>
}

// `providerSettings` is the erased provider-config union at this registry
// boundary. The registration key selects the matching builder, so each cast is
// paired with that builder instead of widening every transport constructor.
const TRANSPORTS: Record<string, TransportRegistration> = {
  ppio: {
    supports: () => true,
    load: async (settings) => {
      const { buildPpioTransport } = await import('./ppio/ppioProvider')
      return buildPpioTransport(settings as Parameters<typeof buildPpioTransport>[0])
    }
  },
  dashscope: {
    supports: () => true,
    load: async (settings) => {
      const { buildDashScopeTransport } = await import('./dashscope/dashscopeProvider')
      return buildDashScopeTransport(settings as Parameters<typeof buildDashScopeTransport>[0])
    }
  },
  modelscope: {
    supports: () => true,
    load: async (settings) => {
      const { buildModelscopeTransport } = await import('./modelscope/modelscopeProvider')
      return buildModelscopeTransport(settings as Parameters<typeof buildModelscopeTransport>[0])
    }
  },
  dmxapi: {
    supports: dmxapiUsesCustomTransport,
    load: async (settings) => {
      const { buildDmxapiTransport } = await import('./dmxapi/dmxapiProvider')
      return buildDmxapiTransport(settings as Parameters<typeof buildDmxapiTransport>[0])
    }
  },
  tokenhub: {
    supports: () => true,
    load: async (settings) => {
      const { buildTokenhubTransport } = await import('./tokenhub/tokenhubProvider')
      return buildTokenhubTransport(settings as Parameters<typeof buildTokenhubTransport>[0])
    }
  }
}

export function hasImageTransport(providerId: string, modelId: string): boolean {
  return TRANSPORTS[providerId]?.supports(modelId) ?? false
}

export function resolveImageTransport(
  providerId: string,
  modelId: string,
  providerSettings: unknown
): Promise<ImageGenerationTransport<VendorBag> | null> {
  const registration = TRANSPORTS[providerId]
  return registration?.supports(modelId) ? registration.load(providerSettings) : Promise.resolve(null)
}
