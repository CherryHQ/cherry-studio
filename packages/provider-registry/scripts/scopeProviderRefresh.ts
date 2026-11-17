import type { Provider } from '../src/providers/types'

/** Source-only refreshes cannot reconstruct upstream-enriched or standalone offers. */
export function selectSourceProviders(
  providers: readonly Provider[],
  providerIds: readonly string[],
  conflictingMode = false
): Provider[] {
  if (conflictingMode) throw new Error('--provider cannot be combined with --model or --providers-only')
  if (!providerIds.length || providerIds.some((id) => !id.trim())) throw new Error('Select a non-empty provider id')
  return [...new Set(providerIds)].map((id) => {
    const provider = providers.find((entry) => entry.id === id)
    if (!provider) throw new Error(`Unknown provider: ${id}`)
    if (
      provider.modelsDevProvider ||
      provider.fetchModels ||
      provider.modelTemplates !== undefined ||
      provider.standaloneModelIds !== undefined
    ) {
      throw new Error(`Provider ${id} requires full catalogue generation`)
    }
    if (!provider.overrides?.length) throw new Error(`Provider ${id} has no explicit offers`)
    return provider
  })
}

/** Preserve canonical models and unselected offers, even when upstream data has changed. */
export function scopeProviderRefresh<M extends { id: string }, O extends { providerId: string; modelId: string }>(
  current: { models: M[]; overrides: O[] },
  generated: O[],
  providerIds: readonly string[]
): { models: M[]; overrides: O[] } {
  if (!providerIds.length || providerIds.some((id) => !id.trim())) throw new Error('Select a non-empty provider id')
  const selected = new Set(providerIds)
  const canonicalIds = new Set(current.models.map((model) => model.id))
  const offers = generated.filter((row) => selected.has(row.providerId))
  for (const providerId of selected) {
    if (!offers.some((row) => row.providerId === providerId)) throw new Error(`Provider ${providerId} has no offers`)
  }
  for (const offer of offers) {
    if (!canonicalIds.has(offer.modelId)) throw new Error(`Unknown canonical model: ${offer.modelId}`)
  }
  return {
    models: current.models,
    overrides: [...current.overrides.filter((row) => !selected.has(row.providerId)), ...offers].sort((a, b) =>
      `${a.providerId} ${a.modelId}`.localeCompare(`${b.providerId} ${b.modelId}`)
    )
  }
}
