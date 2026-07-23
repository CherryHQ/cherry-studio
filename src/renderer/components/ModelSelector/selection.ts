/**
 * Pure selection-transition helpers for the multi-select design invariants.
 *
 * These rules live here as pure functions so the invariants can be locked in
 * by unit tests — they were explicitly called out in the PR description as
 * the contracts most likely to break under future refactors:
 *
 * - `computeCollapsedSelection`: `multiSelectMode` ON→OFF collapses the
 *   business value to `slice(0, 1)` (the first valid id that survived
 *   provider-level filtering). The OFF→ON direction never emits — that
 *   concern is up to the caller (we simply don't provide a "collapse-to-
 *   empty" helper, so there is nothing to accidentally emit).
 *
 * - `computeToggledSelection`: toggles against the **raw** business value
 *   (the un-narrowed `props.value` snapshot), so that ids belonging to a
 *   provider that is temporarily disabled survive a single click on an
 *   unrelated row instead of being silently erased.
 */

import type { UniqueModelId } from '@shared/data/types/model'

function areSelectedIdsEqual(left: readonly UniqueModelId[], right: readonly UniqueModelId[]) {
  return left.length === right.length && left.every((modelId, index) => modelId === right[index])
}

/**
 * Compute the collapsed selection for `multiSelectMode` ON→OFF.
 *
 * Returns the new selection to emit, or `null` when no change is needed
 * (already collapsed / equal to raw). Callers MUST only invoke this on the
 * ON→OFF transition — invoking on OFF→ON and emitting the result would
 * overwrite business data with a truncated snapshot.
 */
export function computeCollapsedSelection(
  resolvedSelectedModelIds: readonly UniqueModelId[],
  rawSelectedModelIds: readonly UniqueModelId[]
): UniqueModelId[] | null {
  const collapsed = resolvedSelectedModelIds.slice(0, 1)
  if (areSelectedIdsEqual(collapsed, rawSelectedModelIds)) {
    return null
  }
  return collapsed
}

/**
 * Toggle a single id against the raw (un-narrowed) selection base.
 *
 * Using the raw base preserves ids that are currently hidden from the UI
 * (e.g. because their provider is disabled) — otherwise a single toggle on
 * a visible row would silently drop every hidden id.
 */
export function computeToggledSelection(
  rawSelectedModelIds: readonly UniqueModelId[],
  modelId: UniqueModelId
): UniqueModelId[] {
  return rawSelectedModelIds.includes(modelId)
    ? rawSelectedModelIds.filter((id) => id !== modelId)
    : [...rawSelectedModelIds, modelId]
}
