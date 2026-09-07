/**
 * Token dialects — the axis along which token estimation varies (text tokenizer + image
 * cost). These four double as the *wire* dialect: what shapes the endpoint's request format
 * can physically carry (see `resolveToolResultMediaCapabilities`).
 */

import { ENDPOINT_TYPE, type EndpointType, type Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { resolveEffectiveEndpoint } from '../provider/endpoint'

export type TokenDialect = 'anthropic' | 'openai' | 'google' | 'ollama'

/**
 * Wire dialect of an endpoint, keyed on the endpoint **type** (the protocol) — never the
 * provider's `adapterFamily`, which is vendor identity: a relay (AiHubMix / NewAPI / DMXAPI /
 * CherryIN / Bedrock) exposes an `anthropic-messages` / `google-generate-content` endpoint
 * while carrying a vendor-specific family, and the protocol is what determines the tokenizer,
 * media cost, remote-count availability, and what media the wire can carry. Anything else
 * (`openai-chat-completions`, `openai-responses`, …) is the openai-compatible default.
 */
export function resolveEndpointTokenDialect(endpointType: EndpointType | undefined): TokenDialect {
  switch (endpointType) {
    case ENDPOINT_TYPE.ANTHROPIC_MESSAGES:
      return 'anthropic'
    case ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT:
      return 'google'
    case ENDPOINT_TYPE.OLLAMA_CHAT:
    case ENDPOINT_TYPE.OLLAMA_GENERATE:
      return 'ollama'
    default:
      return 'openai'
  }
}

/** Dialect of the endpoint a resolved provider+model pair actually talks to. */
export function resolveModelTokenDialect(provider: Provider, model: Model): TokenDialect {
  const { endpointType } = resolveEffectiveEndpoint(provider, model)
  return resolveEndpointTokenDialect(endpointType)
}
