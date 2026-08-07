/**
 * Model-dependent provider-native tool eligibility compiled from provider data.
 * This generated provider/model intersection is the runtime source of truth
 * and never reads generic model capabilities.
 */
import type { ServerTool } from '../schemas/enums'
import { normalizeModelId } from '../utils/normalize'
import { PROVIDER_SERVER_TOOL_MODEL_IDS } from './server-tool-models.gen'

const ELIGIBLE_MODEL_IDS = new Map(
  Object.entries(PROVIDER_SERVER_TOOL_MODEL_IDS).map(([providerId, tools]) => [
    providerId,
    new Map(Object.entries(tools).map(([tool, ids]) => [tool as ServerTool, new Set(ids)]))
  ])
)

export function isServerToolModelEligible(rawModelId: string, providerId: string, tool: ServerTool): boolean {
  const ids = ELIGIBLE_MODEL_IDS.get(providerId)?.get(tool)
  if (!ids) return false

  const exact = normalizeModelId(rawModelId, { keepParameterSize: true })
  return ids.has(exact) || ids.has(normalizeModelId(rawModelId))
}
