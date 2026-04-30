import { loggerService } from '@logger'
import { useMutation, useQuery } from '@renderer/data/hooks/useDataApi'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type {
  AgentChannelType,
  CreateAgentChannelDto,
  UpdateAgentChannelDto
} from '@shared/data/api/schemas/agentChannels'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useChannels')

export const useChannels = (type?: AgentChannelType) => {
  const { t } = useTranslation()
  const { data, error, isLoading, refetch, mutate } = useQuery('/channels', {
    query: type ? { type } : undefined,
    swrOptions: { keepPreviousData: false }
  })
  const channels = data ?? []

  const { trigger: createTrigger } = useMutation('POST', '/channels', { refresh: ['/channels'] })
  const createChannel = useCallback(
    async (channelData: CreateAgentChannelDto) => {
      try {
        return await createTrigger({ body: channelData })
      } catch (err) {
        logger.error('Failed to create channel', err as Error)
        window.toast.error(formatErrorMessageWithPrefix(err, t('agent.cherryClaw.channels.createError')))
        return null
      }
    },
    [createTrigger, t]
  )

  const { trigger: updateTrigger } = useMutation('PATCH', '/channels/:channelId', {
    refresh: ({ args }) => ['/channels', `/channels/${args?.params.channelId}` as never]
  })
  const updateChannel = useCallback(
    async (id: string, updates: UpdateAgentChannelDto) => {
      try {
        return await updateTrigger({ params: { channelId: id }, body: updates as never })
      } catch (err) {
        logger.error('Failed to update channel', err as Error)
        window.toast.error(formatErrorMessageWithPrefix(err, t('agent.cherryClaw.channels.updateError')))
        return null
      }
    },
    [updateTrigger, t]
  )

  const { trigger: deleteTrigger } = useMutation('DELETE', '/channels/:channelId', {
    refresh: ['/channels']
  })
  const deleteChannel = useCallback(
    async (id: string) => {
      try {
        await deleteTrigger({ params: { channelId: id } })
      } catch (err) {
        logger.error('Failed to delete channel', err as Error)
        window.toast.error(formatErrorMessageWithPrefix(err, t('agent.cherryClaw.channels.deleteError')))
      }
    },
    [deleteTrigger, t]
  )

  return { channels, error, isLoading, refetch, mutate, createChannel, updateChannel, deleteChannel }
}
