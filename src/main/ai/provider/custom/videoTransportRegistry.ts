import { AIHUBMIX_PROVIDER_NAME, type AihubmixProviderSettings } from './aihubmix/aihubmixProvider'
import { buildAihubmixVideoTransport } from './aihubmix/aihubmixVideoTransport'
import { buildDmxapiHailuoVideoTransport, dmxapiUsesHailuoTransport } from './dmxapi/dmxapiHailuoVideoTransport'
import { DMXAPI_PROVIDER_NAME, type DmxapiProviderSettings } from './dmxapi/dmxapiProvider'
import { buildDmxapiVideoTransport, dmxapiUsesResponsesTransport } from './dmxapi/dmxapiVideoTransport'
import { PPIO_PROVIDER_NAME, type PpioProviderSettings } from './ppio/ppioProvider'
import { buildPpioVideoTransport } from './ppio/ppioVideoTransport'
import type { VideoGenerationTransport } from './videoGenerationModel'

/**
 * Resolve a submit/poll video transport for an aggregator provider, keyed by the
 * resolved AI SDK provider id (`sdkConfig.providerId`). Returns `null` when the
 * provider/model has no custom transport — native providers (Veo / Grok / Luma /
 * Kling / Seedance-ByteDance / Wan-Alibaba) resolve through `provider.videoModel()`
 * instead and never reach the job system.
 *
 * Mirrors `resolveImageTransport`: the video-generation job handler rebuilds the
 * exact same transport after a restart from the persisted `uniqueModelId`,
 * re-reading provider settings (and the apiKey) fresh.
 *
 * Implemented: DMXAPI (HappyHorse + Vidu families; Hailuo TODO), PPIO (unified),
 * AiHubMix (Sora-compatible).
 */
type TransportResolver = (modelId: string, providerSettings: unknown) => VideoGenerationTransport | null

const RESOLVERS: Record<string, TransportResolver> = {
  // DMXAPI is a multi-backend gateway: Hailuo uses the 3-step REST transport, HappyHorse/Vidu
  // use the `/v1/responses` transport; other models have no video transport (→ null).
  [DMXAPI_PROVIDER_NAME]: (modelId, settings) => {
    if (dmxapiUsesHailuoTransport(modelId)) return buildDmxapiHailuoVideoTransport(settings as DmxapiProviderSettings)
    if (dmxapiUsesResponsesTransport(modelId))
      return buildDmxapiVideoTransport(settings as DmxapiProviderSettings, modelId)
    return null
  },
  // PPIO / AiHubMix expose unified video APIs — every video model routes through their transport.
  [PPIO_PROVIDER_NAME]: (_modelId, settings) => buildPpioVideoTransport(settings as PpioProviderSettings),
  [AIHUBMIX_PROVIDER_NAME]: (_modelId, settings) => buildAihubmixVideoTransport(settings as AihubmixProviderSettings)
}

export function resolveVideoTransport(
  aiSdkProviderId: string,
  modelId: string,
  providerSettings: unknown
): VideoGenerationTransport | null {
  const resolver = RESOLVERS[aiSdkProviderId]
  return resolver ? resolver(modelId, providerSettings) : null
}
