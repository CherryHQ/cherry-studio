import { MODEL_PRIORITY_MODE, type ModelPriorityMode } from '@shared/data/types/model'

type ModelDisplayNameSource = {
  id?: string | null
  name?: string | null
  priorityMode?: ModelPriorityMode | null
}

export function getModelDisplayName(model: ModelDisplayNameSource): string {
  const name = model.name || model.id || ''
  if (!name || (model.priorityMode ?? MODEL_PRIORITY_MODE.NONE) === MODEL_PRIORITY_MODE.NONE) {
    return name
  }

  return `${name} ⚡️`
}
