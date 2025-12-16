import type { CreateAgentSessionResponse, CreateSessionForm, GetAgentSessionResponse } from "@renderer/types";
import { formatErrorMessageWithPrefix } from "@renderer/utils/error";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import useSWRInfinite from "swr/infinite";

import { useAgentClient } from "./useAgentClient";

const PAGE_SIZE = 20

export const useSessions = (agentId: string | null) => {
  const { t } = useTranslation()
  const client = useAgentClient()

  const getKey = (pageIndex: number, previousPageData: any) => {
    if (!agentId) return null
    if (previousPageData && previousPageData.data.length === 0) return null
    return [client.getSessionPaths(agentId).base, pageIndex]
  }

  const fetcher = async ([, pageIndex]: [string, number]) => {
    if (!agentId) throw new Error('No active agent.')
    return await client.listSessions(agentId, {
      limit: PAGE_SIZE,
      offset: pageIndex * PAGE_SIZE
    })
  }

  const { data, error, isLoading, isValidating, mutate, size, setSize } = useSWRInfinite(getKey, fetcher)

  const sessions = useMemo(() => {
    if (!data) return []
    return data.flatMap((page) => page.data)
  }, [data])

  const total = data?.[0]?.total ?? 0
  const hasMore = sessions.length < total
  const isLoadingMore = isLoading || (size > 0 && data && typeof data[size - 1] === 'undefined')

  const loadMore = useCallback(() => {
    if (!isLoadingMore && hasMore) {
      setSize(size + 1)
    }
  }, [isLoadingMore, hasMore, setSize, size])

  const createSession = useCallback(
    async (form: CreateSessionForm): Promise<CreateAgentSessionResponse | null> => {
      if (!agentId) return null
      try {
        const result = await client.createSession(agentId, form)
        await mutate(
          (prev) => {
            if (!prev || prev.length === 0) {
              return [{ data: [result], total: 1, limit: PAGE_SIZE, offset: 0 }]
            }
            const newData = [...prev]
            newData[0] = {
              ...newData[0],
              data: [result, ...newData[0].data],
              total: newData[0].total + 1
            }
            return newData
          },
          { revalidate: false }
        )
        return result
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.session.create.error.failed')))
        return null
      }
    },
    [agentId, client, mutate, t]
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
          (prev) =>
            prev?.map((page) => ({
              ...page,
              data: page.data.filter((session) => session.id !== id),
              total: page.total - 1
            })),
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
    loadMore,
    createSession,
    getSession,
    deleteSession
  }
}
