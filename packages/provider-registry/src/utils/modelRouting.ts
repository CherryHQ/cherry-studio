/**
 * Per-model endpoint dispatch — the matcher for `ProviderConfig.modelRouting`.
 *
 * Some providers front several vendors' native protocols behind one registration (the AiHubMix /
 * DMXAPI gateways, Vertex, Azure) and pick the protocol from the model id. The rules are DATA on the
 * provider (`src/providers/*.ts`); this module only knows how to match them, so the request path,
 * the AI SDK class dispatch, and the catalog projection all resolve one endpoint from one table.
 */
import type { EndpointType } from '../schemas/enums'
import type { ProviderModelRoute } from '../schemas/provider'

const regexCache = new Map<string, RegExp>()
function ruleRegex(pattern: string): RegExp {
  let regex = regexCache.get(pattern)
  if (!regex) {
    regex = new RegExp(pattern, 'i')
    regexCache.set(pattern, regex)
  }
  return regex
}

/**
 * The first rule claiming this raw api model id, or `undefined` when none does —
 * callers fall back to the provider's `defaultChatEndpoint` (and its own
 * provider-options namespace), which is what a gateway's passthrough line is.
 */
export function resolveProviderModelRoute(
  routes: readonly ProviderModelRoute[] | undefined,
  modelId: string
): ProviderModelRoute | undefined {
  return routes?.find(
    (route) => ruleRegex(route.pattern).test(modelId) && !(route.exclude && ruleRegex(route.exclude).test(modelId))
  )
}

export interface ModelEndpointInput {
  /** Endpoints the model itself declares — a catalog override, or the provider's own `/models` list. */
  endpointTypes?: readonly EndpointType[]
  /** The provider's per-model dispatch table. */
  modelRouting?: readonly ProviderModelRoute[]
  /** Raw api model id the routing patterns match against. */
  modelId?: string
  defaultChatEndpoint?: EndpointType | null
  /** Narrows which endpoints may be picked at all — e.g. "must be able to carry reasoning". */
  accept?: (endpointType: EndpointType) => boolean
  /** Extra gate for the ROUTED candidate only: the provider must actually declare that endpoint. */
  acceptRoute?: (route: ProviderModelRoute) => boolean
}

/**
 * Which endpoint a (provider, model) pair uses — **the** answer, in one place.
 *
 * Priority: the model's own declaration → the provider's per-model route → the provider default.
 * Request routing and the catalog's reasoning projection both resolve through this; when they
 * disagreed, the renderer offered a vocabulary the wire never spoke (#17900).
 */
export function resolveModelEndpoint(input: ModelEndpointInput): {
  endpointType: EndpointType | undefined
  route: ProviderModelRoute | undefined
} {
  const accept = input.accept ?? (() => true)

  const declared = input.endpointTypes?.find(accept)
  const match = input.modelId ? resolveProviderModelRoute(input.modelRouting, input.modelId) : undefined
  const route = match && accept(match.endpointType) && (input.acceptRoute?.(match) ?? true) ? match : undefined
  const fallback =
    input.defaultChatEndpoint && accept(input.defaultChatEndpoint) ? input.defaultChatEndpoint : undefined

  return { endpointType: declared ?? route?.endpointType ?? fallback, route }
}
