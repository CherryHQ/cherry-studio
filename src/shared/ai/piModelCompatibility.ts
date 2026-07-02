/**
 * pi (pi.dev) provider-compatibility mapping.
 *
 * Pure, immutable Cherry endpoint/adapter-family → pi `api`-family lookup,
 * shared by renderer model filtering (`useAgentModelFilter`) and main-side
 * validation/provider-injection so the two sides cannot drift. No service
 * imports, no runtime state — this file must stay importable from both
 * processes.
 *
 * See plan D2: pi speaks a fixed set of wire protocols via
 * `pi.registerProvider({ api })`; providers whose Cherry endpoint has no pi
 * equivalent are unsupported for pi agents.
 */

import type { Model } from '@shared/data/types/model'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

/**
 * The subset of pi's `KnownApi` families Cherry can drive in v1. Kept as a
 * local literal union (not imported from the pi SDK) because pi is a main-only
 * ESM dependency and this module is cross-process. Every member is assignable
 * to pi's `Api` type (`KnownApi | (string & {})`), so a pi driver can pass it
 * straight into `registerProvider`.
 */
export type PiApi =
  | 'anthropic-messages'
  | 'openai-completions'
  | 'openai-responses'
  | 'azure-openai-responses'
  | 'google-generative-ai'

/**
 * Map a Cherry endpoint (`endpointType` + resolved `adapterFamily`) to the pi
 * `api` family, or `undefined` when pi cannot speak that provider's protocol.
 *
 * `adapterFamily` refines cases where the raw endpoint type is ambiguous:
 * Azure and Vertex reuse the OpenAI/Google endpoint types but need a different
 * wire protocol or auth model.
 */
export function mapEndpointToPiApi(
  endpointType: EndpointType | undefined,
  adapterFamily: string | undefined
): PiApi | undefined {
  // Azure OpenAI speaks a distinct wire protocol (deployment + api-version in
  // the URL path). pi ships only an Azure *responses* family, so Azure is
  // supported solely through its responses endpoint; the Azure
  // chat-completions endpoint has no pi equivalent (mapping it to plain
  // `openai-completions` would target the wrong URL shape).
  if (adapterFamily === 'azure-responses') return 'azure-openai-responses'
  if (adapterFamily === 'azure') return undefined

  // Bedrock (AWS SigV4) and Vertex (GCP service-account) authenticate with
  // signed requests / short-lived tokens, which do not fit pi's
  // apiKey/baseUrl `registerProvider` model. Excluded for v1 even though pi has
  // `bedrock-converse-stream` / `google-vertex` families.
  // simplification ceiling: add these families once Cherry can hand pi the
  // signed-request/service-account credentials they need.
  if (adapterFamily === 'bedrock' || adapterFamily === 'google-vertex' || adapterFamily === 'google-vertex-anthropic') {
    return undefined
  }

  switch (endpointType) {
    case ENDPOINT_TYPE.ANTHROPIC_MESSAGES:
      return 'anthropic-messages'
    case ENDPOINT_TYPE.OPENAI_RESPONSES:
      return 'openai-responses'
    case ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS:
      return 'openai-completions'
    case ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT:
      return 'google-generative-ai'
    // Rerank / embeddings / audio / image / video / ollama / text-completions
    // endpoints are not chat protocols pi drives.
    default:
      return undefined
  }
}

/**
 * The effective chat endpoint the runtime would use: the model's first
 * declared endpoint, else the provider default. Mirrors
 * `resolveEffectiveEndpoint`'s endpoint selection (kept pure here so the
 * renderer, which has no main-only resolver, can reuse it).
 */
function resolveEndpointType(provider: Provider, model: Model): EndpointType | undefined {
  return model.endpointTypes?.[0] ?? provider.defaultChatEndpoint
}

/** Resolve the pi `api` family for a Cherry provider+model, or `undefined` if unsupported. */
export function resolvePiApi(provider: Provider, model: Model): PiApi | undefined {
  const endpointType = resolveEndpointType(provider, model)
  const adapterFamily = endpointType ? provider.endpointConfigs?.[endpointType]?.adapterFamily : undefined
  return mapEndpointToPiApi(endpointType, adapterFamily)
}

/** Whether a pi agent can use this provider+model. Used for renderer filtering. */
export function isPiCompatibleModel(provider: Provider, model: Model): boolean {
  return resolvePiApi(provider, model) !== undefined
}
