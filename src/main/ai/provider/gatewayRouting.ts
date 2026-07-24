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

interface GatewayModelRoute {
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
 * Only routes to an endpoint the provider row ACTUALLY declares. The preset seeder is insert-only
 * (`ProviderService.batchUpsertTx` skips existing rows), so a provider seeded before an endpoint was
 * added to the catalog won't carry it. Routing to an undeclared endpoint would drop `aiSdkProviderId`
 * off the gateway family — breaking both the runtime builder selection and the reasoning namespace,
 * which sends every such model to the generic openai-compatible client. Falling through to the
 * default instead keeps those models on their existing behavior until the row is reconciled.
 */
export function resolveGatewayEndpointType(provider: Provider, model: Model): EndpointType | undefined {
  const router =
    GATEWAY_MODEL_ROUTERS[provider.id] ??
    (provider.presetProviderId ? GATEWAY_MODEL_ROUTERS[provider.presetProviderId] : undefined)
  const endpointType = router?.(model.apiModelId ?? model.id).endpointType
  return endpointType && provider.endpointConfigs?.[endpointType] ? endpointType : undefined
}

/**
 * Namespace consumed by the concrete AI SDK model selected by a gateway's model-id router.
 * `undefined` means the runtime provider is not a registered multi-backend gateway.
 */
export function resolveGatewayProviderOptionsKey(runtimeProviderId: string, modelId: string): string | undefined {
  return GATEWAY_MODEL_ROUTERS[runtimeProviderId]?.(modelId).providerOptionsKey
}
