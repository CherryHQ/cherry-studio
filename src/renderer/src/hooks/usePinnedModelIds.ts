import { usePinnedEntityIds } from './usePinnedEntityIds'

/**
 * Model-specific shim over {@link usePinnedEntityIds}.
 *
 * Return shape is preserved for existing callers; `pinnedIds` is narrowed to
 * `readonly UniqueModelId[]` via the generic's per-type branch extraction.
 */
export function usePinnedModelIds() {
  return usePinnedEntityIds('model')
}
