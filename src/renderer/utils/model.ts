import type { Model } from '@renderer/types'

export function isFreeModel(model: Model) {
  if (model.provider === 'cherryai') {
    return true
  }

  return (model.id + model.name).toLocaleLowerCase().includes('free')
}

export const getDuplicateModelNames = <T extends Pick<Model, 'name'>>(models: T[]): Set<string> => {
  const nameCounts = new Map<string, number>()

  for (const model of models) {
    nameCounts.set(model.name, (nameCounts.get(model.name) ?? 0) + 1)
  }

  const duplicateNames = new Set<string>()

  for (const [name, count] of nameCounts.entries()) {
    if (count > 1) {
      duplicateNames.add(name)
    }
  }

  return duplicateNames
}
