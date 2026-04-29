import { useMutation, useQuery } from '@renderer/data/hooks/useDataApi'
import type { ChannelType } from '@shared/data/api/schemas/channels'
import { useCallback } from 'react'

export const useChannels = (type?: ChannelType) => {
  const { data, error, isLoading, refetch, mutate } = useQuery('/channels', {
    query: type ? { type } : undefined,
    swrOptions: { keepPreviousData: false }
  })
  const channels = data ?? []

  const { trigger: createTrigger } = useMutation('POST', '/channels', { refresh: ['/channels'] })
  const createChannel = useCallback(
    async (channelData: Record<string, unknown>) => {
      return createTrigger({ body: channelData as never })
    },
    [createTrigger]
  )

  const { trigger: updateTrigger } = useMutation('PATCH', '/channels/:channelId', {
    refresh: ({ args }) => ['/channels', `/channels/${args?.params.channelId}` as never]
  })
  const updateChannel = useCallback(
    async (id: string, updates: Record<string, unknown>) => {
      return updateTrigger({ params: { channelId: id }, body: updates as never })
    },
    [updateTrigger]
  )

  const { trigger: deleteTrigger } = useMutation('DELETE', '/channels/:channelId', {
    refresh: ['/channels']
  })
  const deleteChannel = useCallback(
    async (id: string) => {
      await deleteTrigger({ params: { channelId: id } })
    },
    [deleteTrigger]
  )

  return { channels, error, isLoading, refetch, mutate, createChannel, updateChannel, deleteChannel }
}
