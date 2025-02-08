import store from '@renderer/store'
import { Model } from '@renderer/types'
import { pick } from 'lodash'

export const getModelUniqId = (m?: Model) => {
  return m?.id ? JSON.stringify(pick(m, ['id', 'provider'])) : ''
}

export const hasModel = (m?: Model) => {
  const allModels = store
    .getState()
    .llm.providers.filter((p) => p.enabled)
    .map((p) => p.models)
    .flat()

  return allModels.find((model) => model.id === m?.id)
}

export function getModelName(model?: Model) {
  return model?.name || model?.id || ''
}
