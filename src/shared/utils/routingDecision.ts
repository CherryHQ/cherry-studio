// The category-vs-difficulty pick at the heart of category routing, factored out so a live preview
// (renderer, before sending) and the actual dispatch (main, `categoryRouting.ts`) can never disagree.

import type { ModelHealthMemory } from '@shared/data/preference/preferenceTypes'
import { isUniqueModelId, type UniqueModelId } from '@shared/data/types/model'

import { freshModelHealth } from './modelHealth'
import { getModelQualityScore } from './modelQuality'
import type { TaskDifficulty } from './taskCategory'

/** Highest-quality model whose last probe passed, used to rescue a known-broken default. */
export function bestHealthyModelId(
  health: ModelHealthMemory,
  modelExists: (id: UniqueModelId) => boolean
): UniqueModelId | undefined {
  return Object.entries(health)
    .filter(([id, entry]) => freshModelHealth(entry)?.ok && isUniqueModelId(id) && modelExists(id))
    .map(([id]) => id as UniqueModelId)
    .sort((a, b) => getModelQualityScore(b) - getModelQualityScore(a))[0]
}

/**
 * Best of an already-resolved candidate list: the strongest model for hard work, the weakest still
 * -healthy one for easy work, so a scarce frontier quota is not spent on a one-line edit.
 */
export function pickCategoryModel(
  candidates: readonly UniqueModelId[],
  health: ModelHealthMemory,
  difficulty: TaskDifficulty
): UniqueModelId {
  const usable = candidates.filter((id) => freshModelHealth(health[id])?.ok !== false)
  const pool = usable.length > 0 ? usable : candidates
  const byQuality = [...pool].sort((a, b) => getModelQualityScore(b) - getModelQualityScore(a))
  return difficulty === 'hard' ? byQuality[0] : byQuality[byQuality.length - 1]
}
