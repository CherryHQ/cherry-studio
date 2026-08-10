/**
 * Per-model provider-native tool constraints compiled from creator data.
 * Same runtime contract as `serverToolModelEligibility`: exact-id lookups
 * over generated tables, never generic model capabilities or runtime regex.
 */
import { normalizeModelId } from '../utils/normalize'
import { SERVER_TOOL_FUNCTION_MIXING_MODEL_IDS, WEB_SEARCH_UNSUPPORTED_EFFORTS } from './server-tool-constraints.gen'

const MIXING_MODEL_IDS = new Set(SERVER_TOOL_FUNCTION_MIXING_MODEL_IDS)

/** Whether the model's provider-native tools coexist with function declarations (absent ⇒ conflict-prone). */
export function supportsServerToolFunctionMixing(rawModelId: string): boolean {
  return (
    MIXING_MODEL_IDS.has(normalizeModelId(rawModelId, { keepParameterSize: true })) ||
    MIXING_MODEL_IDS.has(normalizeModelId(rawModelId))
  )
}

/** Whether the provider-native web-search tool rejects this reasoning effort on this model. */
export function isWebSearchEffortUnsupported(rawModelId: string, effort: string): boolean {
  const efforts =
    WEB_SEARCH_UNSUPPORTED_EFFORTS[normalizeModelId(rawModelId, { keepParameterSize: true })] ??
    WEB_SEARCH_UNSUPPORTED_EFFORTS[normalizeModelId(rawModelId)]
  return efforts?.includes(effort) ?? false
}
