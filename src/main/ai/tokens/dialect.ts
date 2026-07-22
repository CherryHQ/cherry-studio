/**
 * Token dialects — the axis along which token estimation varies (text tokenizer + image
 * cost). A provider's per-endpoint `adapterFamily` (~26 catalog values) collapses onto
 * these four. The same four values double as the *wire* dialect: what shapes the
 * endpoint's request format can physically carry (see `resolveToolResultMediaCapabilities`).
 */

import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { resolveEffectiveEndpoint } from '../provider/endpoint'

export type TokenDialect = 'anthropic' | 'openai' | 'google' | 'ollama'

/**
 * Normalize a provider endpoint `adapterFamily` to a {@link TokenDialect}. Unknown or
 * missing families fall through to `openai` — the openai-compatible terminal default,
 * mirroring `resolveAiSdkProviderId`'s own fallback (`src/main/ai/provider/endpoint.ts`).
 */
export function resolveTokenDialect(adapterFamily: string | undefined): TokenDialect {
  switch (adapterFamily) {
    case 'anthropic':
    case 'google-vertex-anthropic':
      return 'anthropic'
    case 'google':
    case 'google-vertex':
      return 'google'
    case 'ollama':
      return 'ollama'
    default:
      return 'openai'
  }
}

/** Dialect of the endpoint a resolved provider+model pair actually talks to. */
export function resolveModelTokenDialect(provider: Provider, model: Model): TokenDialect {
  const { endpointType } = resolveEffectiveEndpoint(provider, model)
  return resolveTokenDialect(endpointType ? provider.endpointConfigs?.[endpointType]?.adapterFamily : undefined)
}
