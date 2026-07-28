/**
 * Multi-backend gateway endpoint routing.
 *
 * A gateway (AiHubMix, …) is one registered provider whose runtime factory dispatches a model to a
 * wire endpoint by its id. That same rule is surfaced here so `resolveEffectiveEndpoint` can fill in
 * the per-model endpoint at request time for models that carry no explicit `endpointTypes` — the API
 * list has no `supported_endpoint_types` and user-added ids never pass through it. Downstream this
 * drives the reasoning-options namespace/dialect and the endpoint-keyed feature gates.
 *
 * This module is a thin dispatch table: each entry points at the provider's own `*Routing.ts`, which
 * owns the actual rule. Adding a gateway is one import + one row here — never business logic.
 */
import type { EndpointType, Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { SystemProviderIds } from '@shared/utils/systemProviderId'

import { resolveAihubmixChatRoute } from './custom/aihubmix/aihubmixRouting'
import { resolveDmxapiChatRoute } from './custom/dmxapi/dmxapiRouting'

export interface GatewayModelRoute {
  endpointType: EndpointType
  providerOptionsKey: string
}

type GatewayModelRouter = (modelId: string) => GatewayModelRoute

const GATEWAY_MODEL_ROUTERS: Partial<Record<string, GatewayModelRouter>> = {
  [SystemProviderIds.aihubmix]: resolveAihubmixChatRoute,
  [SystemProviderIds.dmxapi]: resolveDmxapiChatRoute
}

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
  const router =
    GATEWAY_MODEL_ROUTERS[provider.id] ??
    (provider.presetProviderId ? GATEWAY_MODEL_ROUTERS[provider.presetProviderId] : undefined)
  const route = router?.(model.apiModelId ?? model.id)
  return route && provider.endpointConfigs?.[route.endpointType] ? route : undefined
}
