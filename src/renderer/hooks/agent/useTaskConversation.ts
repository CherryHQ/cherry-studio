import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { cacheService } from '@renderer/data/CacheService'
import { useDataChange, useQuery } from '@renderer/data/hooks/useDataApi'
import { useCurrentTabId } from '@renderer/hooks/tab'
import {
  readTaskConversationPage,
  resolveTaskConversation,
  type TaskConversationResult
} from '@renderer/services/taskConversation'
import type { ScheduledTaskEntity } from '@shared/data/api/schemas/agents'

type State = { key: string; result?: TaskConversationResult; loading: boolean; error?: unknown; newerRunId?: string }

export function useTaskConversation(task: ScheduledTaskEntity | null | undefined, runId?: string) {
  const key = `${task?.id ?? ''}:${runId ?? ''}`
  const [state, setState] = useState<State>({ key, loading: !!task })
  const [revision, setRevision] = useState(0)
  const controller = useRef<AbortController | null>(null)
  const taskRef = useRef(task)
  taskRef.current = task
  const visible: State = state.key === key ? state : { key, loading: !!task }
  const result = visible.result
  const retry = useCallback(() => setRevision((value) => value + 1), [])
  const resumeConversation = useRef(() => false)
  resumeConversation.current = () => {
    if (!result?.session) return false
    // Activity retains the selection while disconnecting effects; only history needs refreshing.
    setState((current) => ({ ...current, loading: false }))
    refreshHistory()
    return true
  }

  useEffect(() => {
    const currentTask = taskRef.current
    const abort = new AbortController()
    controller.current = abort
    if (resumeConversation.current()) return () => abort.abort()
    setState({ key, loading: !!currentTask })
    if (currentTask) {
      void resolveTaskConversation(currentTask, runId, abort.signal).then(
        (next) => {
          if (!abort.signal.aborted) setState({ key, result: next, loading: false })
        },
        (error) => {
          if (!abort.signal.aborted) setState({ key, loading: false, error })
        }
      )
    }
    return () => abort.abort()
  }, [key, runId, revision])

  const busy = useRef(false)
  const loadMore = useCallback(async () => {
    if (!task || !result || visible.loading || busy.current || (result.nextPage - 1) * 50 >= result.total) return
    busy.current = true
    const signal = controller.current?.signal
    setState((current) => ({ ...current, loading: true, error: undefined }))
    try {
      const next = await readTaskConversationPage(task, result.nextPage, signal)
      if (signal?.aborted) return
      setState((current) =>
        current.key !== key || !current.result
          ? current
          : {
              key,
              loading: false,
              newerRunId: current.newerRunId,
              result: {
                ...next,
                ...(current.result.session || runId
                  ? {
                      session: current.result.session,
                      runId: current.result.runId,
                      startedAt: current.result.startedAt
                    }
                  : {}),
                logs: [
                  ...current.result.logs,
                  ...next.logs.filter((log) => !current.result!.logs.some((existing) => existing.id === log.id))
                ]
              }
            }
      )
    } catch (error) {
      if (!signal?.aborted) setState((current) => ({ ...current, loading: false, error }))
    } finally {
      busy.current = false
    }
  }, [task, result, visible.loading, key, runId])

  const refreshHistory = () => {
    if (!task) return
    if (!result?.session) {
      retry()
      return
    }
    const signal = controller.current?.signal
    void readTaskConversationPage(task, 1, signal)
      .then((first) => {
        if (signal?.aborted) return
        setState((current) =>
          current.key !== key || !current.result
            ? current
            : {
                ...current,
                error: undefined,
                newerRunId: first.session && first.session.id !== current.result.session?.id ? first.runId : undefined,
                result: {
                  ...current.result,
                  total: first.total,
                  logs: [
                    ...first.logs,
                    ...current.result.logs.filter((log) => !first.logs.some((fresh) => fresh.id === log.id))
                  ]
                }
              }
        )
      })
      .catch((error) => {
        if (!signal?.aborted) setState((current) => ({ ...current, error }))
      })
  }
  useDataChange('/agents/:agentId/tasks/:taskId/logs', refreshHistory, {
    routeParams: task ? { taskId: task.id } : undefined
  })

  const sessionId = result?.session?.id
  const {
    data: session,
    error: sessionError,
    refetch
  } = useQuery('/agent-sessions/:sessionId', {
    params: { sessionId: sessionId! },
    enabled: !!sessionId,
    swrOptions: { keepPreviousData: false }
  })
  useDataChange('/agent-sessions/:sessionId', (effects) => {
    if (sessionId && effects.some((effect) => !effect.entityIds || effect.entityIds.includes(sessionId))) void refetch()
  })
  const verifiedSession = !sessionError && session && session.id === sessionId ? session : null
  const tabId = useCurrentTabId()
  useLayoutEffect(() => {
    if (!tabId) return
    const cacheKey = `scheduled-task.conversation.${tabId}`
    if (!task || !verifiedSession) {
      cacheService.deleteCasual(cacheKey)
      return
    }
    // Tab ownership survives Activity hiding; TabsProvider's navigation owner clears closed tabs.
    cacheService.setCasual(cacheKey, { taskId: task.id, runId, sessionId: verifiedSession.id })
  }, [tabId, task, runId, verifiedSession])

  return {
    ...visible,
    session: verifiedSession,
    sessionLoading: !!sessionId && !session && !sessionError,
    error: sessionError ?? visible.error,
    loadMore,
    retry: () => {
      if (result?.session) {
        void refetch()
        refreshHistory()
      } else retry()
    },
    hasMore: !!result && (result.nextPage - 1) * 50 < result.total
  }
}
