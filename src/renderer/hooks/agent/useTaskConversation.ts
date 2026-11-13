import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { cacheService } from '@renderer/data/CacheService'
import { useDataChange, useQuery } from '@renderer/data/hooks/useDataApi'
import { useCurrentTabId } from '@renderer/hooks/tab'
import {
  isTaskRunSessionUnavailable,
  readTaskConversationPage,
  resolveTaskConversation,
  type TaskConversationResult
} from '@renderer/services/taskConversation'
import type { ScheduledTaskEntity } from '@shared/data/api/schemas/agents'

type State = {
  taskId?: string
  key: string
  result?: TaskConversationResult
  loading: boolean
  error?: unknown
  newerRunId?: string
}

export function useTaskConversation(task: ScheduledTaskEntity | null | undefined, runId?: string) {
  const key = `${task?.id ?? ''}:${runId ?? ''}`
  const [state, setState] = useState<State>({ key, loading: !!task })
  const [revision, setRevision] = useState(0)
  const controller = useRef<AbortController | null>(null)
  const latestRequest = useRef(0)
  const taskRef = useRef(task)
  taskRef.current = task
  const visible: State =
    state.key === key
      ? state
      : {
          key,
          loading: !!task,
          result:
            state.taskId === task?.id && state.result
              ? { ...state.result, session: null, selectedRun: null, runId: undefined, startedAt: undefined }
              : undefined
        }
  const result = visible.result
  const resultRef = useRef(result)
  resultRef.current = result
  const retry = useCallback(() => setRevision((value) => value + 1), [])
  const resumeConversation = useRef<() => boolean>(() => false)
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
    const retained = resultRef.current
    setState({ key, taskId: currentTask?.id, result: retained, loading: !!currentTask })
    if (currentTask) {
      const request = ++latestRequest.current
      void resolveTaskConversation(currentTask, runId, abort.signal).then(
        (next) => {
          if (!abort.signal.aborted && request === latestRequest.current)
            setState({ key, taskId: currentTask.id, result: next, loading: false })
        },
        (error) => {
          if (!abort.signal.aborted && request === latestRequest.current)
            setState({ key, taskId: currentTask.id, result: retained, loading: false, error })
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
              taskId: task.id,
              loading: false,
              newerRunId: current.newerRunId,
              result: {
                ...next,
                ...(current.result.session || runId
                  ? {
                      selectedRun: current.result.selectedRun,
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
    const signal = controller.current?.signal
    const request = ++latestRequest.current
    const refreshed =
      runId || !result?.session
        ? resolveTaskConversation(task, runId, signal)
        : readTaskConversationPage(task, 1, signal)
    void Promise.all([refreshed, runId ? readTaskConversationPage(task, 1, signal) : refreshed])
      .then(([first, firstPage]) => {
        if (signal?.aborted || request !== latestRequest.current) return
        setState((current) => {
          if (current.key !== key) return current
          if (!current.result || (!runId && !current.result.session && !current.result.selectedRun))
            return {
              key,
              taskId: task.id,
              result: {
                ...first,
                logs: [
                  ...firstPage.logs,
                  ...(current.result?.logs.filter((log) => !firstPage.logs.some((fresh) => fresh.id === log.id)) ?? [])
                ],
                nextPage: Math.max(first.nextPage, current.result?.nextPage ?? 0),
                total: Math.max(firstPage.total, current.result?.total ?? 0)
              },
              loading: false
            }
          const selectedRun =
            first.selectedRun?.id === current.result.selectedRun?.id
              ? first.selectedRun
              : first.logs.find((log) => log.id === current.result!.selectedRun?.id)
          return {
            ...current,
            loading: false,
            error: undefined,
            newerRunId:
              firstPage.session && firstPage.session.id !== current.result.session?.id ? firstPage.runId : undefined,
            result: {
              ...current.result,
              ...(runId
                ? {
                    selectedRun: first.selectedRun,
                    session: current.result.session ?? first.session,
                    runId: first.runId,
                    startedAt: first.startedAt
                  }
                : selectedRun
                  ? {
                      selectedRun: {
                        id: selectedRun.id,
                        status: selectedRun.status,
                        result: selectedRun.result ?? null,
                        error: selectedRun.error ?? null,
                        startedAt: selectedRun.startedAt
                      },
                      startedAt: selectedRun.startedAt
                    }
                  : {}),
              total: firstPage.total,
              logs: [
                ...firstPage.logs,
                ...current.result.logs.filter((log) => !firstPage.logs.some((fresh) => fresh.id === log.id))
              ]
            }
          }
        })
      })
      .catch((error) => {
        if (!signal?.aborted && request === latestRequest.current) {
          setState((current) =>
            current.key !== key || current.result?.session || current.result?.selectedRun
              ? current
              : { ...current, loading: false, error }
          )
        }
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
  const unavailable = !!result?.selectedRun && !!sessionId && isTaskRunSessionUnavailable(sessionError, sessionId)
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
    error: (unavailable ? undefined : sessionError) ?? visible.error,
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
