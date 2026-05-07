import { type ApiModelsFilter, ApiModelsResponseSchema } from '@renderer/types'
import useSWRImmutable from 'swr/immutable'

export const useApiModels = (filter?: ApiModelsFilter) => {
  const { data, error, isLoading } = useSWRImmutable(['agent-models', filter ?? {}] as const, ([, currentFilter]) =>
    window.api.agent.getModels(currentFilter).then((res) => ApiModelsResponseSchema.parse(res).data)
  )

  return { models: data ?? [], error, isLoading }
}
