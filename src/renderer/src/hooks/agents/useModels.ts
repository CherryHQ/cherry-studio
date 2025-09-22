import { ApiModelsFilter } from '@renderer/types'
import { merge } from 'lodash'
import { useCallback } from 'react'
import useSWR from 'swr'

import { useAgentClient } from './useAgentClient'

export const useApiModels = (filter?: ApiModelsFilter) => {
  const client = useAgentClient()
  // const defaultFilter = { limit: -1 } satisfies ApiModelsFilter
  const defaultFilter = {} satisfies ApiModelsFilter
  const finalFilter = merge(filter, defaultFilter)
  const path = client.getModelsPath(finalFilter)
  const fetcher = useCallback(() => {
    return client.getModels(finalFilter)
  }, [client, finalFilter])
  const { data, error, isLoading } = useSWR(path, fetcher)
  return {
    models: data?.data ?? [],
    error,
    isLoading
  }
}
