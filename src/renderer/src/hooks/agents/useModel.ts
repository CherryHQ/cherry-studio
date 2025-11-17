import type { ApiModelsFilter } from '@renderer/types'

import { useApiModels } from './useModels'

export type UseModelProps = {
  id?: string
  filter?: ApiModelsFilter
}

export const useApiModel = ({ id, filter }: UseModelProps) => {
  const { models } = useApiModels(filter)
  return models.find((model) => model.id === id)
}
