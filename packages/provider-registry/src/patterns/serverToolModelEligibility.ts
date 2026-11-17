/**
 * Model-dependent provider-native tool eligibility compiled from provider data.
 * This generated provider/model intersection is the runtime source of truth
 * and never reads generic model capabilities.
 */
import type { EndpointType, ServerTool } from '../schemas/enums'
import { normalizeModelId } from '../utils/normalize'
import { PROVIDER_SERVER_TOOL_MODEL_IDS } from './server-tool-models.gen'

interface EligibilityDeclaration {
  ids: Set<string>
  /** Endpoint protocols this declaration serves; absent ⇒ every configured endpoint. */
  endpointTypes?: Set<EndpointType>
}

const ELIGIBLE_DECLARATIONS = new Map(
  Object.entries(PROVIDER_SERVER_TOOL_MODEL_IDS).map(([providerId, tools]) => [
    providerId,
    new Map(
      Object.entries(tools).map(([tool, declarations]) => [
        tool as ServerTool,
        declarations.map(
          (declaration): EligibilityDeclaration => ({
            ids: new Set(declaration.ids),
            ...(declaration.endpointTypes ? { endpointTypes: new Set(declaration.endpointTypes) } : {})
          })
        )
      ])
    )
  ])
)

/**
 * A model is eligible when SOME declaration claims it and — once the caller pins the request's
 * endpoint — that same declaration serves the endpoint. An undefined endpoint never excludes by
 * endpoint, so broad "is this model declared" queries keep working.
 */
export function isServerToolModelEligible(
  rawModelId: string,
  providerId: string,
  tool: ServerTool,
  endpointType?: EndpointType
): boolean {
  const declarations = ELIGIBLE_DECLARATIONS.get(providerId)?.get(tool)
  if (!declarations?.length) return false

  const exact = normalizeModelId(rawModelId, { keepParameterSize: true })
  return declarations.some(
    (declaration) =>
      (declaration.ids.has(exact) || declaration.ids.has(normalizeModelId(rawModelId))) &&
      (!declaration.endpointTypes?.size || endpointType === undefined || declaration.endpointTypes.has(endpointType))
  )
}
