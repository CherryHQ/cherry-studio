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

import { resolveGatewayChatRoute } from '@shared/data/presets/gatewayChatRouting'
import { hasRuntimeTransportAdapter } from '@shared/data/presets/runtimeTransport'
import type { Model } from '@shared/data/types/model'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isLoginBasedProvider } from '@shared/utils/provider'

/**
 * Login-based providers Cherry can still drive through pi via a per-request
 * "transport adapter" (main-side: `src/main/ai/provider/runtimeTransport.ts`):
 * their OAuth token, provider headers, and payload rewrite are injected at
 * stream time, so unlike an external-CLI login (`claude-code`) they DO fit pi's
 * provider model. This id list is the pure, cross-process source of truth; the
 * main-side adapter registry keys off the SAME ids (its record type is derived
 * from this const, so the two cannot drift). Kept as a tuple so that derivation
 * stays exhaustive.
 */
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
/**
 * Chat endpoints to consider for a model, in preference order: the model's
 * declared endpoints first, then the gateway route, then the provider default.
 */
function candidateEndpointTypes(provider: Provider, model: Model): EndpointType[] {
  const candidates: EndpointType[] = [...(model.endpointTypes ?? [])]
  const gateway = resolveGatewayChatRoute(provider, model)?.endpointType
  if (gateway) candidates.push(gateway)
  if (provider.defaultChatEndpoint) candidates.push(provider.defaultChatEndpoint)
  return [...new Set(candidates)]
}

/**
 * The effective chat endpoint the pi runtime uses. Preference order is kept,
 * but a declared endpoint with no pi protocol no longer hides a later declared
 * endpoint that has one (#19184): the model's first endpoint is used when it
 * maps, else the first declared endpoint that does, else the first candidate.
 */
function resolveEndpointType(provider: Provider, model: Model): EndpointType | undefined {
  const candidates = candidateEndpointTypes(provider, model)
  if (candidates.length === 0) return undefined
  for (const candidate of candidates) {
    if (mapEndpointToPiApi(candidate, provider.endpointConfigs?.[candidate]?.adapterFamily) !== undefined) {
      return candidate
    }
  }
  return candidates[0]
}

/** Resolve the pi `api` family for a Cherry provider+model, or `undefined` if unsupported. */
export function resolvePiApi(provider: Provider, model: Model): PiApi | undefined {
  // Login-based providers hold no plain app-side API key. An external-CLI login
  // (`claude-code`) reuses a CLI's own stored session and cannot be injected, so
  // it stays unsupported like Bedrock/Vertex above. App-managed OAuth providers
  // (`grok-cli`/`openai-codex`), however, have a pi transport adapter that
  // injects their OAuth token + provider headers + payload rewrite per request —
  // so they ARE drivable and fall through to the normal endpoint mapping.
  if (isLoginBasedProvider(provider) && !hasRuntimeTransportAdapter(provider.id)) return undefined
  const endpointType = resolveEndpointType(provider, model)
  const adapterFamily = endpointType ? provider.endpointConfigs?.[endpointType]?.adapterFamily : undefined
  return mapEndpointToPiApi(endpointType, adapterFamily)
}

/** Whether a pi agent can use this provider+model. Used for renderer filtering. */
export function isPiCompatibleModel(provider: Provider, model: Model): boolean {
  return resolvePiApi(provider, model) !== undefined
}
