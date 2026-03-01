import type {
  CreateAgentSessionResponse,
  CreateSessionForm,
  GetAgentSessionResponse,
  ListAgentSessionsResponse
} from '@renderer/types'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import useSWRInfinite from 'swr/infinite'

import { useAgentClient } from './useAgentClient'

const DEFAULT_PAGE_SIZE = 20

export const useSessions = (agentId: string | null, pageSize = DEFAULT_PAGE_SIZE) => {
  const { t } = useTranslation()
  const client = useAgentClient()

  const getKey = (pageIndex: number, previousPageData: ListAgentSessionsResponse | null) => {
    if (!agentId) return null
    if (previousPageData && previousPageData.data.length < pageSize) return null
    return [client.getSessionPaths(agentId).base, pageIndex, pageSize]
  }

  const fetcher = async ([, pageIndex, pageLimit]: [string, number, number]) => {
    if (!agentId) throw new Error('No active agent.')
    return await client.listSessions(agentId, {
      limit: pageLimit,
      offset: pageIndex * pageLimit
    })
  }

  const { data, error, isLoading, isValidating, mutate, size, setSize } = useSWRInfinite(getKey, fetcher)

  const sessions = useMemo(() => {
    if (!data) return []
    return data.flatMap((page) => page.data)
  }, [data])

  const total = useMemo(() => {
    if (!data || data.length === 0) return 0
    return data[data.length - 1].total
  }, [data])
  const hasMore = sessions.length < total
  const isLoadingMore = isLoading || (size > 0 && data && typeof data[size - 1] === 'undefined')

  const loadMore = useCallback(() => {
    if (!isLoadingMore && hasMore) {
      setSize((currentSize) => currentSize + 1)
    }
  }, [isLoadingMore, hasMore, setSize])

  const reload = useCallback(async () => {
    await mutate()
  }, [mutate])

  const createSession = useCallback(
    async (form: CreateSessionForm): Promise<CreateAgentSessionResponse | null> => {
      if (!agentId) return null
      try {
        const result = await client.createSession(agentId, form)
        mutate(
          (prev) => {
            if (!prev || prev.length === 0) {
              return [{ data: [result], total: 1, limit: pageSize, offset: 0 }]
            }
            const newTotal = prev[0].total + 1
            return prev.map((page, i) => ({
              ...page,
              data: i === 0 ? [result, ...page.data] : page.data,
              total: newTotal
            }))
          },
          { revalidate: false }
        )
        return result
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.session.create.error.failed')))
        return null
      }
    },
    [agentId, client, mutate, pageSize, t]
  )

  const getSession = useCallback(
    async (id: string): Promise<GetAgentSessionResponse | null> => {
      if (!agentId) return null
      try {
        const result = await client.getSession(agentId, id)
        mutate(
          (prev) =>
            prev?.map((page) => ({
              ...page,
              data: page.data.map((session) => (session.id === result.id ? result : session))
            })),
          { revalidate: false }
        )
        return result
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.session.get.error.failed')))
        return null
      }
    },
    [agentId, client, mutate, t]
  )

  const deleteSession = useCallback(
    async (id: string): Promise<boolean> => {
      if (!agentId) return false
      try {
        await client.deleteSession(agentId, id)
        mutate(
          (prev) => {
            if (!prev || prev.length === 0) return prev
            const newTotal = prev[0].total - 1
            return prev.map((page) => ({
              ...page,
              data: page.data.filter((session) => session.id !== id),
              total: newTotal
            }))
          },
          { revalidate: false }
        )
        return true
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.session.delete.error.failed')))
        return false
      }
    },
    [agentId, client, mutate, t]
  )

  return {
    sessions,
    total,
    hasMore,
    error,
    isLoading,
    isLoadingMore,
    isValidating,
    reload,
    loadMore,
    createSession,
    getSession,
    deleteSession
  }
}
