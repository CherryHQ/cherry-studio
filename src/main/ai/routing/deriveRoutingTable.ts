// Ranks every available model per task category from data the app already has, so pasting a key is
// enough to get sensible routing. A hand-written mapping went stale the moment a provider was
// switched off, and asking the user to maintain one per category is the step they never take.

import type { ModelHealthMemory, TaskCategory } from '@shared/data/preference/preferenceTypes'
import { MODALITY, MODEL_CAPABILITY, type UniqueModelId } from '@shared/data/types/model'
import type { DerivedRoutingTable, RoutingCandidate } from '@shared/data/types/routing'
import { freshModelHealth } from '@shared/utils/modelHealth'
import { getModelQualityScore } from '@shared/utils/modelQuality'

/** The slice of a model this ranking needs; keeps the function free of the data layer. */
export type RoutableModel = {
  id: UniqueModelId
  providerId: string
  capabilities: readonly string[]
  /** Absent on models synced from a provider that does not declare it. */
  outputModalities?: readonly string[]
}

export type DeriveRoutingInput = {
  models: readonly RoutableModel[]
  health: ModelHealthMemory
  /** Providers whose declared key ceilings are all spent; ranked last but never removed. */
  exhaustedProviderIds: ReadonlySet<string>
}

const CATEGORIES: readonly TaskCategory[] = ['code', 'research', 'writing', 'image', 'general']

/** Big enough to sink a broken model below any quality gap, small enough that it still ranks. */
const UNHEALTHY_PENALTY = 60
const QUOTA_PENALTY = 40
const HEALTHY_BONUS = 10
/** Exceeds the full quality spread, so any native image model outranks any chat model for images. */
const NATIVE_IMAGE_BONUS = 100

/** Keep the count bounded: past a handful, a candidate will never be reached. */
const MAX_CANDIDATES_PER_CATEGORY = 8

function has(model: RoutableModel, capability: string): boolean {
  return model.capabilities.includes(capability)
}

/** Whether the model can produce the text a chat turn is made of. */
function emitsText(model: RoutableModel): boolean {
  if (has(model, MODEL_CAPABILITY.EMBEDDING) || has(model, MODEL_CAPABILITY.RERANK)) return false
  // A provider that declares its modalities is believed; one that does not is assumed to chat,
  // which is what the overwhelming majority of synced models do.
  return model.outputModalities === undefined || model.outputModalities.includes(MODALITY.TEXT)
}

/**
 * Excluded rather than demoted, because unlike a failed probe this will not come right on a retry:
 * an embedding model cannot hold a conversation, and a text-to-image model cannot write code. Left
 * in the list they would eventually be picked for easy work and fail every time.
 */
function isEligible(model: RoutableModel, category: TaskCategory): boolean {
  if (emitsText(model)) return true
  return category === 'image' && has(model, MODEL_CAPABILITY.IMAGE_GENERATION)
}

/**
 * How well a model's declared capabilities suit a kind of work. Deliberately small next to the
 * quality score: capability flags say what a model *can* do, not how well it does it.
 */
function categoryAffinity(model: RoutableModel, category: TaskCategory): number {
  const tools = has(model, MODEL_CAPABILITY.FUNCTION_CALL) ? 10 : 0
  const reasoning = has(model, MODEL_CAPABILITY.REASONING) ? 10 : 0

  switch (category) {
    case 'code':
      return tools + reasoning
    case 'research':
      // Research leans on tool calls to reach the web; reasoning helps less than being able to look.
      return tools + reasoning / 2
    case 'image':
      // Large enough to clear the whole quality range, because that range measures *text* ability,
      // which says nothing about generated images. A tool-calling chat model reaches the image tool
      // and stays as a fallback — it only wins when the native model is failing its probes.
      return has(model, MODEL_CAPABILITY.IMAGE_GENERATION) ? NATIVE_IMAGE_BONUS : tools
    case 'writing':
    case 'general':
      return 0
  }
}

function scoreFor(model: RoutableModel, category: TaskCategory, input: DeriveRoutingInput): RoutingCandidate {
  const probe = freshModelHealth(input.health[model.id])
  const quality = getModelQualityScore(model.id)
  const affinity = categoryAffinity(model, category)
  const healthDelta = probe?.ok === false ? -UNHEALTHY_PENALTY : probe?.ok === true ? HEALTHY_BONUS : 0
  const quotaDelta = input.exhaustedProviderIds.has(model.providerId) ? -QUOTA_PENALTY : 0

  return {
    id: model.id,
    score: quality + affinity + healthDelta + quotaDelta,
    quality,
    affinity,
    healthDelta,
    quotaDelta
  }
}

/**
 * Ranks the available models for every category. With no health data yet — a fresh install, a key
 * pasted a moment ago — quality and capability alone still produce a usable order, so routing works
 * before the first probe rather than after it.
 */
export function deriveRoutingTable(input: DeriveRoutingInput): DerivedRoutingTable {
  return Object.fromEntries(
    CATEGORIES.map((category) => [
      category,
      input.models
        .filter((model) => isEligible(model, category))
        .map((model) => scoreFor(model, category, input))
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
        .slice(0, MAX_CANDIDATES_PER_CATEGORY)
    ])
  ) as DerivedRoutingTable
}
