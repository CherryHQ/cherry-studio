import { useCallback } from 'react'
import useSWR from 'swr'

import { useApiServer } from '../useApiServer'
import { useAgentClient } from './useAgentClient'

export const useChannels = (type?: string) => {
  const client = useAgentClient()
  const { apiServerRunning } = useApiServer()

  const key = apiServerRunning ? `${client.channelPaths.base}?type=${type ?? ''}` : null

  const fetcher = useCallback(async () => {
    const result = await client.listChannels(type ? { type } : undefined)
    return result.data
  }, [client, type])

  const { data, error, isLoading, mutate } = useSWR(key, fetcher)

  const createChannel = useCallback(
    async (channelData: Record<string, unknown>) => {
      const result = await client.createChannel(channelData)
      void mutate((prev) => [...(prev ?? []), result], false)
      return result
    },
    [client, mutate]
  )

  const updateChannel = useCallback(
    async (id: string, updates: Record<string, unknown>) => {
      const result = await client.updateChannel(id, updates)
      void mutate((prev) => prev?.map((ch) => (ch.id === id ? result : ch)) ?? [], false)
      return result
    },
    [client, mutate]
  )

  const deleteChannel = useCallback(
    async (id: string) => {
      await client.deleteChannel(id)
      void mutate((prev) => prev?.filter((ch) => ch.id !== id) ?? [], false)
    },
    [client, mutate]
  )

  return {
    channels: data,
    error,
    isLoading,
    mutate,
    createChannel,
    updateChannel,
    deleteChannel
  }
}
