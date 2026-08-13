/**
 * dsh (DeepSeek Harness) provider-compatibility mapping.
 *
 * Pure, immutable Cherry endpoint/adapter-family → dsh `api`-protocol lookup,
 * shared by renderer model filtering and main-side validation/composition so
 * the two sides cannot drift. No service imports, no runtime state — this file
 * must stay importable from both processes.
 *
 * dsh drives models through `dsh-llm-pi-ai`, whose hand-declared route config
 * accepts only the wire protocols it can completely describe with an API key,
 * an endpoint, and headers; providers whose Cherry endpoint has no dsh
 * equivalent are unsupported for dsh agents.
 */

import { MODALITY } from '@cherrystudio/provider-registry'
import { resolveGatewayChatRoute } from '@shared/data/presets/gatewayChatRouting'
import type { Model } from '@shared/data/types/model'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isLoginBasedProvider } from '@shared/utils/provider'

/**
 * The wire protocols `dsh-llm-pi-ai` (0.1.0-rc.6) accepts for a hand-declared
 * provider route — its `PROTOCOLS` table. Narrower than pi's family set: Azure
 * (needs an api-version), Bedrock/Vertex (signed requests), and
 * `google-generative-ai` (not yet in the table) are all refused at composition
 * load, so mapping them here would ship agents that cannot boot.
 */
export type DshApi = 'anthropic-messages' | 'openai-completions' | 'openai-responses'

/**
 * Map a Cherry endpoint (`endpointType` + resolved `adapterFamily`) to the dsh
 * `api` protocol, or `undefined` when dsh cannot speak that provider's protocol.
 *
 * `adapterFamily` refines cases where the raw endpoint type is ambiguous:
 * Azure, Bedrock, and Vertex reuse the OpenAI/Anthropic/Google endpoint types
 * but need a different wire protocol or auth model.
 */
export function mapEndpointToDshApi(
  endpointType: EndpointType | undefined,
  adapterFamily: string | undefined
): DshApi | undefined {
  // Azure needs provider environment plus an api-version, which dsh-llm-pi-ai's
  // route config cannot express — both Azure families are refused upstream.
  if (adapterFamily === 'azure-responses' || adapterFamily === 'azure') return undefined

  // Bedrock (AWS SigV4) and Vertex (GCP service-account) authenticate with
  // signed requests / short-lived tokens no dsh route config can express either.
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
    // google-generative-ai is absent from dsh's hand-declared PROTOCOLS table;
    // rerank/embeddings/audio/image/video/ollama are not chat protocols it drives.
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
  return (
    model.endpointTypes?.[0] ?? resolveGatewayChatRoute(provider, model)?.endpointType ?? provider.defaultChatEndpoint
  )
}

/** Resolve the dsh `api` protocol for a Cherry provider+model, or `undefined` if unsupported. */
export function resolveDshApi(provider: Provider, model: Model): DshApi | undefined {
  // dsh runs as a subprocess with no per-request transport injection, so every login-based
  // provider is undrivable — including the app-managed OAuth ones pi adapts in-process.
  if (isLoginBasedProvider(provider)) return undefined
  const endpointType = resolveEndpointType(provider, model)
  const adapterFamily = endpointType ? provider.endpointConfigs?.[endpointType]?.adapterFamily : undefined
  return mapEndpointToDshApi(endpointType, adapterFamily)
}

/** dsh's route config requires a per-model context window, so an unknown value is not safely drivable. */
export function hasKnownDshContextWindow(model: Model): model is Model & { contextWindow: number } {
  return typeof model.contextWindow === 'number' && Number.isFinite(model.contextWindow) && model.contextWindow > 0
}

/** DSH rc.6 always requires text input; undeclared modalities retain the existing chat-model default. */
export function hasDshTextInput(model: Model): boolean {
  return model.inputModalities === undefined || model.inputModalities.includes(MODALITY.TEXT)
}

/** Whether a dsh agent can use this provider+model. Used for renderer filtering. */
export function isDshCompatibleModel(provider: Provider, model: Model): boolean {
  return resolveDshApi(provider, model) !== undefined && hasKnownDshContextWindow(model) && hasDshTextInput(model)
}
