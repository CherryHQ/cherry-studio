import type { Model } from '@shared/data/types/model'

import { groupModels } from './modelListDerivedState'

/**
 * Move a whole group of models as a block inside the provider's full list.
 *
 * Group order is derived from model order, so reordering a group is exactly a
 * block move of its members. Mirrors `reorderProviderBlocks` in
 * `ProviderListContent`: the moved models are lifted out of the full list and
 * re-inserted around the target group, so members hidden by a search or
 * capability filter travel with their group and every other row keeps its
 * relative position.
 *
 * `sourceIndex` and `targetIndex` are the drag's group indices. Direction
 * decides the landing spot: a group dragged down goes *after* the target's
 * last member, one dragged up goes *before* its first. Without that split a
 * downward drag lands above the target and the row jumps back on the next
 * paint.
 *
 * Both id sets are derived with `groupModels` so the blocks match the grouping
 * the list actually renders — a group can be wider on screen than the visible
 * rows suggest.
 */
export function reorderModelGroups({
  models,
  activeGroupName,
  overGroupName,
  sourceIndex,
  targetIndex
}: {
  models: readonly Model[]
  activeGroupName: string
  overGroupName: string
  sourceIndex: number
  targetIndex: number
}): readonly Model[] {
  if (activeGroupName === overGroupName) return models

  const groups = groupModels(models, true, { preferModelGroup: true })
  const activeIds = new Set((groups[activeGroupName] ?? []).map((model) => model.id))
  const overIds = new Set((groups[overGroupName] ?? []).map((model) => model.id))

  const moving = models.filter((model) => activeIds.has(model.id))
  if (moving.length === 0) return models

  const remaining = models.filter((model) => !activeIds.has(model.id))
  const movingDown = sourceIndex < targetIndex

  const overIndexes = remaining.flatMap((model, index) => (overIds.has(model.id) ? [index] : []))
  const anchor = movingDown ? overIndexes.at(-1) : overIndexes[0]
  if (anchor === undefined) return models

  const insertIndex = movingDown ? anchor + 1 : anchor
  const next = [...remaining]
  next.splice(insertIndex, 0, ...moving)
  return next
}
