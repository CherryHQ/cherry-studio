import { isManagedCherryCloudModel } from '@shared/data/presets/cherryai'
import { resolveGatewayChatRoute } from '@shared/data/presets/gatewayChatRouting'
import {
  ENDPOINT_TYPE,
  endpointImpliedCapability,
  type EndpointType,
  type Model,
  MODEL_CAPABILITY
} from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isNonChatModel } from '@shared/utils/model'

export interface CanonicalEndpointSelection {
  endpointType: EndpointType | undefined
  gatewayProviderOptionsKey?: string
}

export type EndpointSelectionProvider = Pick<
  Provider,
  'id' | 'presetProviderId' | 'defaultChatEndpoint' | 'endpointConfigs'
>

/**
 * Resolve the configured host for an endpoint selected by the canonical route resolver.
 *
 * OpenAI-compatible providers often expose one shared `/v1` host under chat-completions
 * while declaring Responses-capable models in their catalog. Keep that compatibility
 * fallback in one place so direct integrations (for example DSH and OpenClaw) materialize
 * the same host that endpoint selection already accepts.
 */
export function resolveEndpointBaseUrl(
  provider: Pick<Provider, 'id' | 'presetProviderId' | 'endpointConfigs'>,
  endpointType: EndpointType
): string | undefined {
  const configured = provider.endpointConfigs?.[endpointType]?.baseUrl
  if (configured) return configured

  const isKnownGateway =
    provider.id === 'aihubmix' ||
    provider.presetProviderId === 'aihubmix' ||
    provider.id === 'dmxapi' ||
    provider.presetProviderId === 'dmxapi'
  if (endpointType !== ENDPOINT_TYPE.OPENAI_RESPONSES || isKnownGateway) return undefined

  return provider.endpointConfigs?.[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]?.baseUrl
}

/**
 * Select the endpoint protocol shared by main-process requests and endpoint-aware consumers.
 *
 * A candidate is usable only when the provider still has configuration for it. Dedicated
 * non-chat models never inherit chat defaults or chat gateway routes, including capability-only
 * models whose catalog row has no `endpointTypes` hint.
 */
export function resolveCanonicalEndpoint(
  provider: EndpointSelectionProvider,
  model: Model,
  preferredEndpointType?: EndpointType,
  allowedEndpointTypes?: readonly EndpointType[]
): CanonicalEndpointSelection {
  // Persisted/custom rows created before capabilities became required can still omit the array.
  // An endpointTypes entry still carries an unambiguous operation contract, so
  // preserve its dedicated semantics even for those legacy rows.
  const capabilities = model.capabilities ?? []
  const endpointTypes = model.endpointTypes ?? []
  const primaryEndpointCapability = endpointImpliedCapability(endpointTypes[0])
  const hasAnyDedicatedEndpoint = endpointTypes.some(
    (endpointType) => endpointImpliedCapability(endpointType) !== undefined
  )
  const hasDeclaredDedicatedEndpoint = primaryEndpointCapability !== undefined
  // A missing image/embedding/etc. configuration must not silently fall through
  // to a chat endpoint that happens to be configured.
  // A model whose catalog row lists a chat endpoint first is chat-primary even
  // when it also advertises a secondary capability (for example image output).
  // Capability-only rows with no chat endpoint remain non-chat.
  // A chat-primary row may advertise an image-generation capability for a tool
  // call (New API / CherryIN style). In that shape the primary protocol is still
  // the chat transport; only a dedicated primary endpoint or another explicit
  // operation-only capability should force a non-chat route.
  const chatPrimaryImageCapability =
    endpointTypes.length > 0 &&
    !hasDeclaredDedicatedEndpoint &&
    capabilities.includes(MODEL_CAPABILITY.IMAGE_GENERATION)
  const nonChat =
    Boolean(hasDeclaredDedicatedEndpoint) || (isNonChatModel({ ...model, capabilities }) && !chatPrimaryImageCapability)
  const isAllowed = (endpointType: EndpointType | undefined): endpointType is EndpointType =>
    Boolean(endpointType && (!allowedEndpointTypes || allowedEndpointTypes.includes(endpointType)))
  const hasEndpointConfig = (endpointType: EndpointType | undefined): endpointType is EndpointType => {
    if (!isAllowed(endpointType)) return false
    // Cherry Cloud models are provisioned by the authenticated cloud service.
    // Their provider intentionally has no local endpointConfigs/base URL; the
    // dedicated builder supplies the origin and transport after selection.
    if (Boolean(provider.endpointConfigs?.[endpointType]) || isManagedCherryCloudModel(provider.id)) return true

    // Custom OpenAI-compatible providers commonly expose one shared `/v1` host
    // under the Chat endpoint while catalog rows identify Responses-capable
    // models explicitly. Reuse that configured host for the Responses dialect,
    // but never infer it for known multi-backend gateways (their endpoint map is
    // the routing contract and a stale declaration must remain undefined).
    return Boolean(resolveEndpointBaseUrl(provider, endpointType))
  }
  const endpointBackedCapabilities = new Set(
    Object.values(ENDPOINT_TYPE)
      .map(endpointImpliedCapability)
      .filter((capability) => capability !== undefined)
  )
  const hasExplicitEndpointCapability = capabilities.some((capability) => endpointBackedCapabilities.has(capability))
  const endpointMatchesExplicitCapability = (endpointType: EndpointType): boolean => {
    const impliedCapability = endpointImpliedCapability(endpointType)
    return impliedCapability !== undefined && capabilities.includes(impliedCapability)
  }
  const defaultEndpoint = provider.defaultChatEndpoint
  const preferred =
    !nonChat &&
    isAllowed(preferredEndpointType) &&
    model.endpointTypes?.includes(preferredEndpointType) &&
    hasEndpointConfig(preferredEndpointType)
      ? preferredEndpointType
      : undefined
  const supportedProviderDefault =
    !nonChat && defaultEndpoint && model.endpointTypes?.includes(defaultEndpoint) && hasEndpointConfig(defaultEndpoint)
      ? defaultEndpoint
      : undefined
  const capabilityEndpoint =
    nonChat && hasExplicitEndpointCapability
      ? model.endpointTypes?.find(
          (endpointType) => hasEndpointConfig(endpointType) && endpointMatchesExplicitCapability(endpointType)
        )
      : undefined
  const modelEndpoint =
    capabilityEndpoint ??
    model.endpointTypes?.find((endpointType) => {
      if (!hasEndpointConfig(endpointType)) return false
      const impliedCapability = endpointImpliedCapability(endpointType)
      if (!nonChat) return impliedCapability === undefined
      if (!hasExplicitEndpointCapability) return !hasDeclaredDedicatedEndpoint || impliedCapability !== undefined
      // General-purpose protocols such as Gemini generateContent can also serve
      // non-chat capabilities. Trust that declaration only when the row does not
      // advertise any dedicated protocol; a missing provider configuration must
      // not silently reroute a dedicated model through a chat endpoint.
      return impliedCapability === undefined && !hasAnyDedicatedEndpoint
    })
  const gatewayRoute = nonChat ? undefined : resolveGatewayChatRoute(provider, model)
  const hasExplicitModelEndpointDeclaration = (model.endpointTypes?.length ?? 0) > 0
  const fallback =
    !nonChat && !hasExplicitModelEndpointDeclaration && hasEndpointConfig(defaultEndpoint) ? defaultEndpoint : undefined
  // An explicit model endpoint declaration is a hard capability boundary. If that
  // declaration is stale or unconfigured, do not silently reroute through a
  // gateway-derived protocol that the model did not advertise.
  const gatewayEndpoint =
    !hasExplicitModelEndpointDeclaration && isAllowed(gatewayRoute?.endpointType)
      ? gatewayRoute?.endpointType
      : undefined
  const endpointType = preferred ?? supportedProviderDefault ?? modelEndpoint ?? gatewayEndpoint ?? fallback

  return {
    endpointType,
    gatewayProviderOptionsKey:
      gatewayRoute && endpointType === gatewayRoute.endpointType ? gatewayRoute.providerOptionsKey : undefined
  }
}
