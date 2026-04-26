import { getLowerBaseModelName } from '@renderer/utils'
import type { Model } from '@shared/data/types/model'

import type { ProviderSettingsGroupModel } from './types'

export function isFreeModel(model: Pick<Model, 'id' | 'name' | 'providerId'>): boolean {
  if (model.providerId === 'cherryai') {
    return true
  }

  return (model.id + model.name).toLowerCase().includes('free')
}

export function groupQwenModels<T extends ProviderSettingsGroupModel>(models: T[]): Record<string, T[]> {
  return models.reduce(
    (groups, model) => {
      const modelId = getLowerBaseModelName(model.id)
      const prefixMatch = modelId.match(/^(qwen(?:\d+\.\d+|2(?:\.\d+)?|-\d+b|-(?:max|coder|vl)))/i)
      const groupKey = prefixMatch ? prefixMatch[1] : model.group || '其他'

      if (!groups[groupKey]) {
        groups[groupKey] = []
      }
      groups[groupKey].push(model)
      return groups
    },
    {} as Record<string, T[]>
  )
}
