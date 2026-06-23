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
 * Resolve a poll-capable image transport for a custom provider, keyed by the
 * resolved AI SDK provider id (`sdkConfig.providerId`). Returns `null` for
 * providers/models that have no submit/poll transport (they keep the in-SDK
 * `aiCoreGenerateImage` path).
 *
 * This exists so the image-generation job handler can rebuild the exact same
 * transport the SDK path would use — after a restart it has only the persisted
 * `uniqueModelId`, so it re-resolves provider settings (re-reading the apiKey
 * from config, never persisting it) and feeds them back through here. The
 * `build*Transport` helpers are the single source of truth shared with each
 * provider factory.
 */
type TransportResolver = (modelId: string, providerSettings: unknown) => ImageGenerationTransport | null

const RESOLVERS: Record<string, TransportResolver> = {
  [PPIO_PROVIDER_NAME]: (_modelId, settings) => buildPpioTransport(settings as PpioProviderSettings),
  [DASHSCOPE_PROVIDER_NAME]: (_modelId, settings) => buildDashScopeTransport(settings as DashScopeProviderSettings),
  [MODELSCOPE_PROVIDER_NAME]: (_modelId, settings) => buildModelscopeTransport(settings as ModelscopeProviderSettings),
  // DMXAPI is a multi-backend gateway — only its bespoke families use the
  // custom transport (the rest go through native / openai-compat SDK image
  // models, which we leave on the in-SDK path).
  [DMXAPI_PROVIDER_NAME]: (modelId, settings) =>
    dmxapiUsesCustomTransport(modelId) ? buildDmxapiTransport(settings as DmxapiProviderSettings) : null
}

export function resolveImageTransport(
  aiSdkProviderId: string,
  modelId: string,
  providerSettings: unknown
): ImageGenerationTransport | null {
  const resolver = RESOLVERS[aiSdkProviderId]
  return resolver ? resolver(modelId, providerSettings) : null
}
