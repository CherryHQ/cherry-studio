import { useApiModels } from './useModels'

export const useApiModel = ({ id }: { id?: string }) => {
  const { models } = useApiModels()
  return models.find((model) => model.id === id)
}
