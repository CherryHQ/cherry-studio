/**
 * Multi-backend gateway endpoint routing.
 *
 * A gateway (AiHubMix, …) is one registered provider whose runtime factory dispatches a model to a
 * wire endpoint by its id. That same rule is surfaced here so `resolveEffectiveEndpoint` can fill in
 * the per-model endpoint at request time for models that carry no explicit `endpointTypes` — the API
 * list has no `supported_endpoint_types` and user-added ids never pass through it. Downstream this
 * drives the reasoning-options namespace/dialect and the endpoint-keyed feature gates.
 *
 * The pure dispatch table lives in the shared data preset so renderer compatibility and main
 * materialization consume the same route. This module keeps the main provider API stable.
 */
import { type GatewayModelRoute, resolveGatewayChatRoute } from '@shared/data/presets/gatewayChatRouting'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

export type { GatewayModelRoute }

/**
 * The wire endpoint a gateway serves this model on, or `undefined` when the provider isn't a routed
 * gateway (the caller falls back to `provider.defaultChatEndpoint`). Keyed by the runtime provider id
 * and its preset origin, so a user-cloned gateway provider still routes.
 *
 * Only routes to an endpoint the provider row ACTUALLY declares. Runtime resolution must not
 * fabricate connection config for incomplete custom rows; doing so would drop `aiSdkProviderId`
 * off the gateway family and break both builder selection and the reasoning namespace.
 */
export function resolveGatewayRoute(provider: Provider, model: Model): GatewayModelRoute | undefined {
  return resolveGatewayChatRoute(provider, model)
}
