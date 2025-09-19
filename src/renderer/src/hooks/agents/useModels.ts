import { ApiModelsFilter } from '@renderer/types'
import { useCallback } from 'react'
import useSWR from 'swr'

import { useAgentClient } from './useAgentClient'

export const useModels = (filter: ApiModelsFilter) => {
  const client = useAgentClient()
  const path = client.getModelsPath(filter)
  const fetcher = useCallback(() => {
    return client.getModels(filter)
  }, [client, filter])
  const { data, error, isLoading } = useSWR(path, fetcher)
  return {
    models: data?.data,
    error,
    isLoading
  }
}
