/**
 * Bridge between renderer's v1 `Model` and shared/utils/model's v2-typed
 * functions.
 *
 * Why this exists:
 *  - Renderer's `Model` (`@renderer/types`) predates the v2 registry. It
 *    has `id: string`, `provider: string`, and an optional `capabilities`
 *    list that isn't reliably maintained.
 *  - Shared's `Model` (`@shared/data/types/model`) is the v2 registry
 *    schema — it carries a populated `capabilities` array that downstream
 *    check functions query directly.
 *
 * The bridge synthesises the fields shared's checks actually read:
 *  - `id` (branded `providerId::modelId`) for vendor / version ID checks
 *  - `providerId` for provider-specific branches
 *  - `capabilities` for capability-driven checks (populated by running
 *    the same `inferXxxFromModelId` helpers the v2 registry uses)
 *
 * Fields not read by any pure check function (`supportsStreaming`,
 * `isEnabled`, `isHidden`, etc.) are omitted — the `as unknown as
 * SharedModel` cast covers the structural gap.
 * REMOVE it in V2
 */

import type { Modality } from '@cherrystudio/provider-registry'
import { MODALITY } from '@cherrystudio/provider-registry'
import type { Model } from '@renderer/types'
import type { Model as SharedModel, ModelCapability, RuntimeReasoning, UniqueModelId } from '@shared/data/types/model'
import { MODEL_CAPABILITY, UNIQUE_MODEL_ID_SEPARATOR } from '@shared/data/types/model'
import {
  findTokenLimit,
  getLowerBaseModelName,
  inferEmbeddingFromModelId,
  inferFunctionCallingFromModelId,
  inferImageGenerationFromModelId,
  inferReasoningFromModelId,
  inferRerankFromModelId,
  inferVisionFromModelId,
  inferWebSearchFromModelId
} from '@shared/utils/model'

export function toSharedCompatModel(v1: Model): SharedModel {
  const id: UniqueModelId = v1.id.includes(UNIQUE_MODEL_ID_SEPARATOR)
    ? (v1.id as UniqueModelId)
    : `${v1.provider || 'unknown'}${UNIQUE_MODEL_ID_SEPARATOR}${v1.id}`

  const capabilities = inferCapabilities(v1)
  const inputModalities = inferInputModalities(v1)

  return {
    id,
    providerId: v1.provider,
    name: v1.name,
    group: v1.group,
    capabilities,
    inputModalities,
    reasoning: capabilities.includes(MODEL_CAPABILITY.REASONING) ? inferReasoning(v1) : undefined
  } as unknown as SharedModel
}

/**
 * Derive a v2 capability list from a v1 Model by running the same
 * inference helpers the registry uses at model-creation time. We run
 * inference against both `id` and `name` because renderer-era data
 * sometimes stored the real id under `name` (user-imported / custom models).
 */
function inferCapabilities(v1: Model): ModelCapability[] {
  // Capability inference runs on `id` only. Running it on `name` would
  // conflate unrelated strings — e.g. a Hunyuan model whose display name
  // happens to be "gpt-4o" would get WEB_SEARCH via OpenAI heuristics.
  const set = new Set<ModelCapability>()
  const id = v1.id
  if (!id) return []
  if (inferReasoningFromModelId(id)) set.add(MODEL_CAPABILITY.REASONING)
  if (inferVisionFromModelId(id)) set.add(MODEL_CAPABILITY.IMAGE_RECOGNITION)
  if (inferImageGenerationFromModelId(id)) set.add(MODEL_CAPABILITY.IMAGE_GENERATION)
  if (inferEmbeddingFromModelId(id)) set.add(MODEL_CAPABILITY.EMBEDDING)
  if (inferRerankFromModelId(id)) set.add(MODEL_CAPABILITY.RERANK)
  if (inferWebSearchFromModelId(id)) set.add(MODEL_CAPABILITY.WEB_SEARCH)
  if (inferFunctionCallingFromModelId(id)) set.add(MODEL_CAPABILITY.FUNCTION_CALL)
  return Array.from(set)
}

/**
 * Populate the subset of `inputModalities` capability checks actually
 * read. `inferVisionFromModelId` unions both vision-LLMs and image-edit
 * SKUs, so a single inference covers IMAGE input for:
 *   - `isVisionModel` (vision-LLM) — falls back to this field when
 *     `IMAGE_RECOGNITION` isn't set.
 *   - `isEditImageModel` (image-edit) — requires `IMAGE_GENERATION` AND
 *     IMAGE input. The IMAGE_GEN gate filters out pure vision-LLMs.
 */
function inferInputModalities(v1: Model): Modality[] {
  if (!v1.id) return []
  return inferVisionFromModelId(v1.id) ? [MODALITY.IMAGE] : []
}

/**
 * Populate the subset of `RuntimeReasoning` that capability-based runtime
 * checks actually look at:
 *   - `thinkingTokenLimits` — drives `isSupportedThinkingTokenModel`.
 *     Derived from the same `findTokenLimit` table the v2 registry uses.
 *   - `supportedEfforts` — drives `isSupportedReasoningEffortModel` and
 *     effort-option enumeration. Inferred from coarse vendor heuristics
 *     covering the cases the legacy regex-based checks used to gate on.
 *   - `interleaved` — v1 data doesn't encode this; left undefined.
 */
function inferReasoning(v1: Model): RuntimeReasoning | undefined {
  const rawId = v1.id
  if (!rawId) return undefined
  const lowerId = getLowerBaseModelName(rawId)
  const nameLowerId = v1.name ? getLowerBaseModelName(v1.name) : ''

  // Use the lower base name so fireworks-style ids (`glm-4p7` → `glm-4.7`)
  // and `provider/model` prefixes are normalised before pattern matching.
  const thinkingTokenLimits = findTokenLimit(lowerId) ?? (v1.name ? findTokenLimit(nameLowerId) : undefined)
  const supportedEfforts = inferSupportedEfforts(lowerId, nameLowerId)

  if (!thinkingTokenLimits && !supportedEfforts) return undefined
  return {
    thinkingTokenLimits,
    supportedEfforts
  } as RuntimeReasoning
}

function inferSupportedEfforts(lowerId: string, lowerName: string): string[] | undefined {
  const id = `${lowerId} ${lowerName}`
  // OpenAI reasoning-effort gating (o-series, gpt-oss, gpt-5 non-chat)
  if (
    (id.includes('o1') && !id.includes('o1-preview') && !id.includes('o1-mini')) ||
    id.includes('o3') ||
    id.includes('o4') ||
    id.includes('gpt-oss') ||
    (id.includes('gpt-5') && !id.includes('chat'))
  ) {
    return ['low', 'medium', 'high']
  }
  // Grok reasoning-effort variants
  if (id.includes('grok-3-mini')) return ['low', 'high']
  // Perplexity deep-research
  if (id.includes('sonar-deep-research')) return ['medium']
  return undefined
}
