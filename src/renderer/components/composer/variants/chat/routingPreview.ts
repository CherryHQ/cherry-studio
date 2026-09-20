// Mirrors `routeDefaultModelId` (`src/main/ai/streamManager/context/categoryRouting.ts`) using the
// same shared, pure pieces, so this preview can never claim a destination the real dispatch would
// not also pick. Reads only state already recorded in preferences and the shared cache — no probe
// of its own.

import type { CategoryModelMap, ModelHealthMemory, TaskCategory } from '@shared/data/preference/preferenceTypes'
import { isUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { DerivedRoutingTable } from '@shared/data/types/routing'
import { freshModelHealth } from '@shared/utils/modelHealth'
import { bestHealthyModelId, pickCategoryModel } from '@shared/utils/routingDecision'
import { classifyTaskCategory, estimateTaskDifficulty } from '@shared/utils/taskCategory'

export type RoutingPreviewReason = 'pinned' | 'category' | 'health_rescue'

export interface RoutingPreview {
  destinationModelId: UniqueModelId
  reason: RoutingPreviewReason
  category?: TaskCategory
}

export interface RoutingPreviewInput {
  /** The composer's current draft text; only used to classify, never sent anywhere. */
  promptText: string
  /** The model that would be used if routing did not intervene (the assistant/topic default). */
  fallbackModelId: UniqueModelId
  /** An explicit @-mention bypasses routing entirely, same as at send time. */
  hasMentionedModels: boolean
  autoEnabled: boolean
  pinnedModelId: string
  categoryModels: CategoryModelMap
  derivedTable: DerivedRoutingTable
  health: ModelHealthMemory
  /** Whether a unique model id still resolves to an enabled model on an enabled provider. */
  modelExists: (id: UniqueModelId) => boolean
}

/**
 * The model this turn would actually go to, or `undefined` when it would go to `fallbackModelId`
 * anyway — routing is off, unconfigured, mentions already decide it, or nothing would change.
 */
export function computeRoutingPreview(input: RoutingPreviewInput): RoutingPreview | undefined {
  // A preview must never crash the composer; any lookup failure just means "assume the plain
  // selection", same spirit as the try/catch around the live dispatch in `categoryRouting.ts`.
  try {
    const { fallbackModelId, modelExists } = input
    if (input.hasMentionedModels) return undefined

    if (input.pinnedModelId && isUniqueModelId(input.pinnedModelId) && modelExists(input.pinnedModelId)) {
      return input.pinnedModelId === fallbackModelId
        ? undefined
        : { destinationModelId: input.pinnedModelId, reason: 'pinned' }
    }

    if (!input.autoEnabled) return undefined

    const category = classifyTaskCategory(input.promptText)
    const manual = input.categoryModels[category] ?? []
    const derived = input.derivedTable[category].map((candidate) => candidate.id)
    const candidates = [...new Set([...manual, ...derived])].filter(
      (id): id is UniqueModelId => isUniqueModelId(id) && modelExists(id)
    )

    if (candidates.length === 0) {
      if (freshModelHealth(input.health[fallbackModelId])?.ok !== false && modelExists(fallbackModelId)) {
        return undefined
      }
      const rescue = bestHealthyModelId(input.health, modelExists)
      return !rescue || rescue === fallbackModelId ? undefined : { destinationModelId: rescue, reason: 'health_rescue' }
    }

    const difficulty = estimateTaskDifficulty(input.promptText)
    const chosen = pickCategoryModel(candidates, input.health, difficulty)
    return chosen === fallbackModelId ? undefined : { destinationModelId: chosen, reason: 'category', category }
  } catch {
    return undefined
  }
}
