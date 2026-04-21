import type { Model } from '@shared/data/types/model'

export const isValidNewApiModel = (model: Model): boolean => !!(model.endpointTypes && model.endpointTypes.length > 0)

export const filterProviderSettingModelsByKeywords = <T extends Model>(keywords: string, models: T[]): T[] => {
  const parts = keywords
    .toLowerCase()
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)

  if (parts.length === 0) return models

  return models.filter((model) => {
    const haystack = [model.id, model.name, model.group, model.description].filter(Boolean).join(' ').toLowerCase()
    return parts.every((part) => haystack.includes(part))
  })
}

export const getDuplicateProviderSettingModelNames = <T extends Pick<Model, 'name'>>(models: T[]): Set<string> => {
  const counts = new Map<string, number>()

  for (const model of models) {
    counts.set(model.name, (counts.get(model.name) ?? 0) + 1)
  }

  return new Set(
    Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .map(([name]) => name)
  )
}
