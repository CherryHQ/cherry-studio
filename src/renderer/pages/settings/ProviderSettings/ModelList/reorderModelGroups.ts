import type { Model } from '@shared/data/types/model'

import { groupModels } from './modelListDerivedState'

/**
 * Move a whole group of models as a block inside the provider's full list.
 *
 * Group order is derived from model order, so reordering a group is exactly a
 * block move of its members. Mirrors `reorderProviderBlocks` in
 * `ProviderListContent`: the moved models are lifted out of the full list and
 * re-inserted where the target group sits there, so members hidden by a search
 * or capability filter travel with their group and every other row keeps its
 * relative position.
 *
 * Both id sets are derived with `groupModels` so the blocks match the grouping
 * the list actually renders — a group can be wider on screen than the visible
 * rows suggest.
 */
export function reorderModelGroups({
  models,
  activeGroupName,
  overGroupName
}: {
  models: readonly Model[]
  activeGroupName: string
  overGroupName: string
}): readonly Model[] {
  if (activeGroupName === overGroupName) return models

  const groups = groupModels(models, true, { preferModelGroup: true })
  const activeIds = new Set((groups[activeGroupName] ?? []).map((model) => model.id))
  const overIds = new Set((groups[overGroupName] ?? []).map((model) => model.id))

  const moving = models.filter((model) => activeIds.has(model.id))
  if (moving.length === 0) return models

  const remaining = models.filter((model) => !activeIds.has(model.id))
  const targetIndex = remaining.findIndex((model) => overIds.has(model.id))
  if (targetIndex === -1) return models

  return [...remaining.slice(0, targetIndex), ...moving, ...remaining.slice(targetIndex)]
}
