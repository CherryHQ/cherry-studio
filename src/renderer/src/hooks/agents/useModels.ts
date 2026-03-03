import type { ApiModel, ApiModelsFilter } from '@renderer/types'
import { merge } from 'lodash'
import { useCallback, useMemo } from 'react'
import useSWR from 'swr'

import { useAgentClient } from './useAgentClient'

export const useApiModels = (filter?: ApiModelsFilter) => {
  const client = useAgentClient()
  // const defaultFilter = { limit: -1 } satisfies ApiModelsFilter
  const defaultFilter = {} satisfies ApiModelsFilter
  const finalFilter = merge(filter, defaultFilter)

  const path = useMemo(() => {
    // Return a special key to prevent fetching when client is not available
    if (!client) {
      return 'agent-client-disabled'
    }
    return client.getModelsPath(finalFilter)
  }, [client, finalFilter])

  const fetcher = useCallback(async () => {
    // Return empty data if client is not available
    if (!client) {
      return { data: [], total: 0 }
    }

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

  // Skip fetching when client is not available by using a conditional key
  const shouldFetch = client !== null
  const { data, error, isLoading } = useSWR(shouldFetch ? path : null, fetcher)

  return {
    models: data?.data ?? [],
    error,
    isLoading
  }
}
