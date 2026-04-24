import type { ApiModel, ApiModelsFilter } from '@renderer/types'
import { useEffect, useState } from 'react'

export const useApiModels = (filter?: ApiModelsFilter) => {
  const [models, setModels] = useState<ApiModel[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    setIsLoading(true)
    window.api.agent
      .getModels(filter ?? {})
      .then((res: any) => {
        setModels(res.data ?? [])
        setError(null)
      })
      .catch((err: Error) => setError(err))
      .finally(() => setIsLoading(false))
  }, [JSON.stringify(filter)]) // stable dep

  return { models, error, isLoading }
}
