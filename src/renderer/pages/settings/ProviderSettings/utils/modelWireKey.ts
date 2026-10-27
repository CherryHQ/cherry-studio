import type { Model, UniqueModelId } from '@shared/data/types/model'

/**
 * Exact wire identity for a model row: `providerId` + `apiModelId`, never a fuzzy or
 * normalized comparison. It exists because a saved row keeps the catalogue slug as its
 * persistent id while the registry resolves the provider's own wire id, so the two
 * spellings must still match as the same upstream model.
 */
export const modelWireKey = (model: Pick<Model, 'providerId' | 'apiModelId'>): string =>
  `${model.providerId}::${model.apiModelId ?? ''}`

/** Empty wire ids cannot identify a model independently of its persistent id. */
export const modelWireKeyOrNull = (model: Pick<Model, 'providerId' | 'apiModelId'>): string | null =>
  model.apiModelId ? modelWireKey(model) : null

/** Membership accepts a persistent id or a non-empty exact wire identity. */
export function hasModelIdentity(
  model: Model,
  localIds: ReadonlySet<UniqueModelId>,
  localWireKeys: ReadonlySet<string>
): boolean {
  const wireKey = modelWireKeyOrNull(model)
  return localIds.has(model.id) || (wireKey !== null && localWireKeys.has(wireKey))
}

/** Saved aliases retain their persistent ids; exact-id duplicates retain the first row's metadata. */
export function uniqueModelsByIdentity(models: readonly Model[], localModels: readonly Model[]): Model[] {
  const savedByWireKey = new Map<string, Model>()
  for (const model of localModels) {
    const wireKey = modelWireKeyOrNull(model)
    if (wireKey !== null) savedByWireKey.set(wireKey, model)
  }

  const seenIds = new Set<UniqueModelId>()
  const result = new Map<string, Model>()
  for (const model of models) {
    if (seenIds.has(model.id)) continue
    seenIds.add(model.id)

    const wireKey = modelWireKeyOrNull(model)
    const saved = wireKey !== null ? savedByWireKey.get(wireKey) : undefined
    result.set(wireKey !== null ? `wire:${wireKey}` : `id:${model.id}`, saved && saved.id !== model.id ? saved : model)
  }
  return Array.from(result.values())
}
