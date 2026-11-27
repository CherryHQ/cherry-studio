/** Refresh selected canonical models and their offers without importing unrelated upstream drift. */
export function scopeModelRefresh<M extends { id: string }, O extends { modelId: string }>(
  current: { models: M[]; overrides: O[] },
  generated: { models: M[]; overrides: O[] },
  modelIds: readonly string[]
): { models: M[]; overrides: O[] } {
  const selected = new Set(modelIds)
  const generatedIds = new Set(generated.models.map((model) => model.id))
  for (const id of selected) {
    if (!generatedIds.has(id)) throw new Error(`Cannot refresh unknown canonical model: ${id}`)
  }
  return {
    models: [
      ...current.models.filter((model) => !selected.has(model.id)),
      ...generated.models.filter((model) => selected.has(model.id))
    ],
    overrides: [
      ...current.overrides.filter((row) => !selected.has(row.modelId)),
      ...generated.overrides.filter((row) => selected.has(row.modelId))
    ]
  }
}
