/**
 * Pure endpoint-type resolution shared by the main request path and the renderer's composer, so the
 * UI describes the endpoint the request will actually use.
 */
import { endpointImpliedCapability, VENDOR_PATTERNS } from '@cherrystudio/provider-registry'
import { resolveGatewayChatRoute } from '@shared/data/presets/gatewayChatRouting'
import type { GatewayModelRoute } from '@shared/data/presets/gatewayChatRouting'
import type { Model } from '@shared/data/types/model'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { getLowerBaseModelName, getRawModelId } from './model'
import { isNewApiProvider } from './provider'

/** Operation selecting the transport; chat defaults must not redirect other modalities. */
export type ResolveEndpointIntent = 'chat' | 'image' | 'image-edit' | 'embedding' | 'rerank'

/** New API listings often put `openai` before vendor-native protocols; pick the native wire when configured. */
function resolveNewApiModelEndpoint(
  provider: Provider,
  model: Model,
  intent: ResolveEndpointIntent
): EndpointType | undefined {
  const endpointTypes = model.endpointTypes
  if (!endpointTypes?.length || !isNewApiProvider(provider)) return endpointTypes?.[0]

  const primaryEndpoint = endpointTypes[0]
  if (intent === 'image' || intent === 'image-edit') {
    const imageEndpoint =
      intent === 'image-edit' ? ENDPOINT_TYPE.OPENAI_IMAGE_EDIT : ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION
    return endpointTypes.includes(imageEndpoint) &&
      provider.endpointConfigs?.[imageEndpoint]?.adapterFamily === 'newapi'
      ? imageEndpoint
      : primaryEndpoint
  }

  if (endpointImpliedCapability(primaryEndpoint) !== undefined) {
    return primaryEndpoint
  }

  if (intent !== 'chat') return primaryEndpoint

  const modelId = getLowerBaseModelName(getRawModelId(model))
  const pick = (endpointType: EndpointType, matches: boolean): EndpointType | undefined =>
    matches && endpointTypes.includes(endpointType) && provider.endpointConfigs?.[endpointType]
      ? endpointType
      : undefined

  return (
    pick(ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT, VENDOR_PATTERNS.gemini.test(modelId)) ??
    pick(ENDPOINT_TYPE.ANTHROPIC_MESSAGES, VENDOR_PATTERNS.anthropic.test(modelId)) ??
    endpointTypes[0]
  )
}

/**
 * Priority: `preferredEndpointType` → provider chat default → model endpoint (including native New API selection) → gateway per-model route →
 * `provider.defaultChatEndpoint` → `undefined`. The gateway step resolves the wire endpoint from the
 * model id for multi-backend gateways (AiHubMix, …) whose models carry no explicit `endpointTypes`
 * (see `gatewayRouting`). `getBaseUrl` applies its own fallback among `endpointConfigs`.
 *
 * `preferredEndpointType` serves callers that speak exactly one dialect — the Claude Agent SDK speaks
 * Anthropic Messages and nothing else, so it asks for that rather than the in-app-chat default
 * `endpointTypes[0]` expresses. It wins only when the model declares that endpoint AND the provider
 * configures a base URL for it; otherwise the normal order applies and the caller sees the declined
 * preference in the returned `endpointType`. The base-URL condition is not redundant: `getBaseUrl`
 * cascades across `endpointConfigs`, so an unconfigured preference would resolve to another
 * endpoint's host instead of failing.
 */
export function resolveEffectiveEndpointType(
  provider: Provider,
  model: Model,
  preferredEndpointType?: EndpointType,
  intent: ResolveEndpointIntent = 'chat'
): { endpointType: EndpointType | undefined; gatewayRoute: GatewayModelRoute | undefined } {
  const gatewayRoute = resolveGatewayChatRoute(provider, model)
  const preferred =
    preferredEndpointType &&
    model.endpointTypes?.includes(preferredEndpointType) &&
    provider.endpointConfigs?.[preferredEndpointType]?.baseUrl
      ? preferredEndpointType
      : undefined
  const userPreference =
    intent === 'chat' &&
    provider.defaultChatEndpoint &&
    model.endpointTypes?.includes(provider.defaultChatEndpoint) &&
    provider.endpointConfigs?.[provider.defaultChatEndpoint]
      ? provider.defaultChatEndpoint
      : undefined
  // A gateway dispatches a native-primary mixed row by model family even when
  // its saved generic chat default is also declared. Keep metadata on that wire.
  const nativeGatewayRoute =
    intent === 'chat' && gatewayRoute?.endpointType === model.endpointTypes?.[0] ? gatewayRoute : undefined
  const endpointType =
    preferred ??
    nativeGatewayRoute?.endpointType ??
    userPreference ??
    resolveNewApiModelEndpoint(provider, model, intent) ??
    gatewayRoute?.endpointType ??
    provider.defaultChatEndpoint
  return { endpointType, gatewayRoute }
}

/** Candidate protocol for enabled native search; callers retain the chat default for client-only search. */
export function resolveSearchEndpointType(provider: Provider, model: Model): EndpointType | undefined {
  const preferred =
    (provider.presetProviderId ?? provider.id) === 'qwencloud' &&
    model.endpointTypes?.[0] === ENDPOINT_TYPE.OPENAI_RESPONSES
      ? ENDPOINT_TYPE.OPENAI_RESPONSES
      : undefined
  return resolveEffectiveEndpointType(provider, model, preferred).endpointType
}
