import { useApiModels } from './useModels'

export type UseModelProps = {
  id: string
}

export const useApiModel = (id?: string) => {
  const { models } = useApiModels()
  return models.find((model) => model.id === id)
}
