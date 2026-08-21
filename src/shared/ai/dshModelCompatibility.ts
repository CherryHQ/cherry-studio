/**
 * dsh (DeepSeek Harness) provider-compatibility mapping.
 *
 * Pure, immutable Cherry endpoint/adapter-family → dsh `api`-protocol lookup,
 * shared by renderer model filtering and main-side validation/composition so
 * the two sides cannot drift. No service imports, no runtime state — this file
 * must stay importable from both processes.
 *
 * dsh drives generic models through `dsh-llm-pi-ai`; official DeepSeek chat
 * models may use the native `dsh-llm-deepseek` route. Cherry injects OpenAI
 * and Anthropic as declared routes and reuses pi-ai's Google catalog route for
 * Generate Content; providers whose Cherry endpoint has no equivalent fall
 * back to the local API Gateway when the model is gateway-routable.
 */

import { MODALITY } from '@cherrystudio/provider-registry'
import { resolveGatewayChatRoute } from '@shared/data/presets/gatewayChatRouting'
import type { Model } from '@shared/data/types/model'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isGatewayRoutableModel } from '@shared/utils/model'
import { isExternalCliProvider, isLoginBasedProvider } from '@shared/utils/provider'

/**
 * Transport families Cherry can inject into dsh (0.1.1-rc.2). OpenAI and
 * Anthropic use hand-declared pi-ai protocol routes; Google Generate Content
 * reuses pi-ai's built-in `google` catalog provider. Azure and signed
 * Bedrock/Vertex routes cannot be expressed by this composition contract.
 */
export type DshApi = 'anthropic-messages' | 'google-generative-ai' | 'openai-completions' | 'openai-responses'

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
    case ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT:
      return 'google-generative-ai'
    // Rerank/embeddings/audio/image/video/ollama are not chat protocols it drives.
    default:
      return undefined
  }
}

/** The effective chat endpoint the dsh runtime uses, preserving the model's declared preference order. */
export function resolveDshEndpointType(provider: Provider, model: Model): EndpointType | undefined {
  return (
    model.endpointTypes?.[0] ?? resolveGatewayChatRoute(provider, model)?.endpointType ?? provider.defaultChatEndpoint
  )
}

/** Resolve the dsh `api` protocol for a Cherry provider+model, or `undefined` if unsupported. */
export function resolveDshApi(provider: Provider, model: Model): DshApi | undefined {
  // Login-based providers keep their OAuth session in Cherry's main process;
  // returning undefined sends them through the local Gateway instead of leaking
  // a provider token into the dsh subprocess.
  if (isLoginBasedProvider(provider)) return undefined
  const endpointType = resolveDshEndpointType(provider, model)
  const adapterFamily = endpointType ? provider.endpointConfigs?.[endpointType]?.adapterFamily : undefined
  return mapEndpointToDshApi(endpointType, adapterFamily)
}

/** dsh's route config requires a per-model context window, so an unknown value is not safely drivable. */
export function hasKnownDshContextWindow(model: Model): model is Model & { contextWindow: number } {
  return typeof model.contextWindow === 'number' && Number.isFinite(model.contextWindow) && model.contextWindow > 0
}

/** DSH requires text input; undeclared modalities retain the existing chat-model default. */
export function hasDshTextInput(model: Model): boolean {
  return model.inputModalities === undefined || model.inputModalities.includes(MODALITY.TEXT)
}

/**
 * Whether the local API Gateway can front this provider for a dsh session.
 * External-CLI providers are intentionally excluded: the Gateway's AI SDK
 * path cannot reuse their separate CLI login, even though their models are
 * otherwise chat-routable.
 */
export function isDshGatewayRoutableModel(provider: Provider, model: Model): boolean {
  return !isExternalCliProvider(provider) && isGatewayRoutableModel(model)
}

/** Whether a dsh agent can use this provider+model. Used for renderer filtering. */
export function isDshCompatibleModel(provider: Provider, model: Model): boolean {
  // No native wire family → the local API Gateway can still front any provider
  // model it can route as OpenAI-compatible; everything else stays fail-closed.
  if (resolveDshApi(provider, model) === undefined && !isDshGatewayRoutableModel(provider, model)) return false
  return hasKnownDshContextWindow(model) && hasDshTextInput(model)
}
