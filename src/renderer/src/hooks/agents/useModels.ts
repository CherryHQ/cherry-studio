import { ApiModel, ApiModelsFilter } from '@renderer/types'
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
  const fetcher = useCallback(async () => {
    const limit = finalFilter.limit || 100
    let offset = finalFilter.offset || 0
    const allModels: ApiModel[] = []
    let total = Infinity

    while (offset < total) {
      const pageFilter = { ...finalFilter, limit, offset }
      const res = await client.getModels(pageFilter)
      allModels.push(...(res.data || []))
      total = res.total ?? 0
      offset += limit
    }
    return { data: allModels, total }
  }, [client, finalFilter])
  const { data, error, isLoading } = useSWR(path, fetcher)
  return {
    models: data?.data ?? [],
    error,
    isLoading
  }
}
