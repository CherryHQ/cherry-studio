import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { loggerService } from '@logger'
import { useDataChange, useQuery } from '@renderer/data/hooks/useDataApi'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type {
  AgentChannelEntity,
  AgentChannelType,
  CreateAgentChannelDto,
  UpdateAgentChannelDto
} from '@shared/data/api/schemas/agentChannels'

const logger = loggerService.withContext('useChannels')

const EMPTY_CHANNELS: readonly AgentChannelEntity[] = Object.freeze([])

export const useChannels = (type?: AgentChannelType) => {
  const { t } = useTranslation()
  const { data, error, isLoading, refetch, mutate } = useQuery('/agent-channels', {
    query: type ? { type } : undefined,
    swrOptions: { keepPreviousData: false }
  })
  useDataChange('/agent-channels', () => void refetch())
  const channels = data ?? (EMPTY_CHANNELS as AgentChannelEntity[])

  const createChannel = useCallback(
    async (channelData: CreateAgentChannelDto) => {
      try {
        const channel = await ipcApi.request('channel.create', channelData)
        await mutate()
        return channel
      } catch (err) {
        logger.error('Failed to create channel', err as Error)
        toast.error(formatErrorMessageWithPrefix(err, t('agent.channels.createError')))
        return null
      }
    },
    [mutate, t]
  )

  const updateChannel = useCallback(
    async (id: string, updates: UpdateAgentChannelDto) => {
      try {
        const channel = await ipcApi.request('channel.update', { channelId: id, updates })
        await mutate()
        return channel
      } catch (err) {
        logger.error('Failed to update channel', err as Error)
        toast.error(formatErrorMessageWithPrefix(err, t('agent.channels.updateError')))
        return null
      }
    },
    [mutate, t]
  )

  const deleteChannel = useCallback(
    async (id: string) => {
      try {
        await ipcApi.request('channel.delete', { channelId: id })
        await mutate()
      } catch (err) {
        logger.error('Failed to delete channel', err as Error)
        toast.error(formatErrorMessageWithPrefix(err, t('agent.channels.deleteError')))
      }
    },
    [mutate, t]
  )

  return { channels, error, isLoading, refetch, mutate, createChannel, updateChannel, deleteChannel }
}
