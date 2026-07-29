import {
  buildDashScopeTransport,
  DASHSCOPE_PROVIDER_NAME,
  type DashScopeProviderSettings
} from './dashscope/dashscopeProvider'
import {
  buildDmxapiTransport,
  DMXAPI_PROVIDER_NAME,
  type DmxapiProviderSettings,
  dmxapiUsesCustomTransport
} from './dmxapi/dmxapiProvider'
import type { ImageGenerationTransport } from './imageGenerationModel'
import {
  buildModelscopeTransport,
  MODELSCOPE_PROVIDER_NAME,
  type ModelscopeProviderSettings
} from './modelscope/modelscopeProvider'
import { buildPpioTransport, PPIO_PROVIDER_NAME, type PpioProviderSettings } from './ppio/ppioProvider'

/**
 * Resolve a poll-capable image transport for a custom provider. The side-effect
 * free `hasImageTransport` predicate lets `AiService` choose the job path
 * before provider configuration selects and rotates a serving key; the job
 * handler remains the sole credential-selection owner for that path.
 *
 * The image-generation job handler rebuilds the exact same transport after a
 * restart from the persisted `uniqueModelId` and freshly resolved provider
 * settings. The `build*Transport` helpers remain the single source of truth
 * shared with each provider factory.
 */
interface TransportRegistration {
  supports: (modelId: string) => boolean
  build: (providerSettings: unknown) => ImageGenerationTransport
}

const TRANSPORTS: Record<string, TransportRegistration> = {
  [PPIO_PROVIDER_NAME]: {
    supports: () => true,
    build: (settings) => buildPpioTransport(settings as PpioProviderSettings)
  },
  [DASHSCOPE_PROVIDER_NAME]: {
    supports: () => true,
    build: (settings) => buildDashScopeTransport(settings as DashScopeProviderSettings)
  },
  [MODELSCOPE_PROVIDER_NAME]: {
    supports: () => true,
    build: (settings) => buildModelscopeTransport(settings as ModelscopeProviderSettings)
  },
  // DMXAPI is a multi-backend gateway — only its bespoke families use the
  // custom transport (the rest go through native / openai-compat SDK image
  // models, which we leave on the in-SDK path).
  [DMXAPI_PROVIDER_NAME]: {
    supports: dmxapiUsesCustomTransport,
    build: (settings) => buildDmxapiTransport(settings as DmxapiProviderSettings)
  }
}

export function hasImageTransport(providerId: string, modelId: string): boolean {
  return TRANSPORTS[providerId]?.supports(modelId) ?? false
}

export function resolveImageTransport(
  aiSdkProviderId: string,
  modelId: string,
  providerSettings: unknown
): ImageGenerationTransport | null {
  const registration = TRANSPORTS[aiSdkProviderId]
  return registration?.supports(modelId) ? registration.build(providerSettings) : null
}
