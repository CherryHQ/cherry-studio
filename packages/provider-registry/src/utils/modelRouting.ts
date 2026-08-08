/**
 * Per-model endpoint dispatch — the matcher for `RegistryEndpointConfig.serves`.
 *
 * Some providers front several vendors' native protocols behind one registration (the AiHubMix /
 * DMXAPI gateways, Vertex, Azure) and pick the protocol per model. Which creator an endpoint serves
 * is DATA on that endpoint (`src/providers/*.ts`); this module only knows how to read it, so the
 * request path, the AI SDK class dispatch, and the catalog projection all resolve one endpoint from
 * one declaration.
 */
import type { EndpointType } from '../schemas/enums'

/** The subset of an endpoint's config this dispatch reads. */
export interface EndpointDispatchConfig {
  /** Which ids this endpoint serves instead of the provider default. */
  serves?: { pattern: string; except?: string }
  /** Namespace override for the AI SDK class behind this endpoint. */
  providerOptionsKey?: string
}

const regexCache = new Map<string, RegExp>()
function ruleRegex(pattern: string): RegExp {
  let regex = regexCache.get(pattern)
  if (!regex) {
    regex = new RegExp(pattern, 'i')
    regexCache.set(pattern, regex)
  }
  return regex
}

/** A resolved dispatch: the endpoint claiming this model, plus that endpoint's namespace override. */
export interface ResolvedModelRoute {
  endpointType: EndpointType
  providerOptionsKey?: string
}

/**
 * The endpoint whose `serves` claims this model id, or `undefined` when none does — callers fall
 * back to the provider's `defaultChatEndpoint` (and its own provider-options namespace), which is
 * what a gateway's passthrough line is.
 *
 * Claims are written to be mutually exclusive, so iteration order carries no meaning: an id two
 * endpoints could both take is a bug in the data, not a precedence question.
 */
export function resolveProviderModelRoute(
  endpointConfigs: Partial<Record<EndpointType, EndpointDispatchConfig>> | undefined,
  modelId: string | undefined
): ResolvedModelRoute | undefined {
  if (!endpointConfigs || !modelId) return undefined

  for (const [endpointType, config] of Object.entries(endpointConfigs)) {
    const serves = config?.serves
    if (!serves || !ruleRegex(serves.pattern).test(modelId)) continue
    if (serves.except && ruleRegex(serves.except).test(modelId)) continue
    return { endpointType: endpointType as EndpointType, providerOptionsKey: config.providerOptionsKey }
  }
  return undefined
}

export interface ModelEndpointInput {
  /** Endpoints the model itself declares — a catalog override, or the provider's own `/models` list. */
  endpointTypes?: readonly EndpointType[]
  /** The provider's endpoints, each declaring which creators it serves. */
  endpointConfigs?: Partial<Record<EndpointType, EndpointDispatchConfig>>
  /** Raw api model id — what each endpoint's `serves` pattern matches against. */
  modelId?: string
  defaultChatEndpoint?: EndpointType | null
  /** Narrows which endpoints may be picked at all — e.g. "must be able to carry reasoning". */
  accept?: (endpointType: EndpointType) => boolean
}

/**
 * Which endpoint a (provider, model) pair uses — **the** answer, in one place.
 *
 * Priority: the model's own declaration → the endpoint claiming the id → the provider default.
 * Request routing and the catalog's reasoning projection both resolve through this; when they
 * disagreed, the renderer offered a vocabulary the wire never spoke (#17900). A per-SKU exception
 * (an OpenAI model with no Responses support) is expressed as the model's own `endpointTypes`, which
 * takes the first slot, or as the claiming endpoint's `except`.
 */
export function resolveModelEndpoint(input: ModelEndpointInput): {
  endpointType: EndpointType | undefined
  route: ResolvedModelRoute | undefined
} {
  const accept = input.accept ?? (() => true)

  const declared = input.endpointTypes?.find(accept)
  const match = resolveProviderModelRoute(input.endpointConfigs, input.modelId)
  const route = match && accept(match.endpointType) ? match : undefined
  const fallback =
    input.defaultChatEndpoint && accept(input.defaultChatEndpoint) ? input.defaultChatEndpoint : undefined

  return { endpointType: declared ?? route?.endpointType ?? fallback, route }
}
