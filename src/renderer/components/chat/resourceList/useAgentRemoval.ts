import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { loggerService } from '@logger'
import { archiveAgentSessionsPopup } from '@renderer/components/chat/archiveAgentSessionsPopup'
import {
  deleteConversationOwnerPopup,
  permanentDeletePopup
} from '@renderer/components/chat/DeleteConversationOwnerConfirmDialog'
import { dataApiService } from '@renderer/data/DataApiService'
import { useInvalidateCache } from '@renderer/data/hooks/useDataApi'
import type { AgentSessionsSource } from '@renderer/hooks/resourceViewSources'
import { useCloseConversationTabs } from '@renderer/hooks/tab'
import { ipcApi } from '@renderer/ipc'
import {
  restoreRecycleBinItems,
  restoreRecycleBinUndoGroup,
  showRecycleBinBatchUndo,
  showRecycleBinUndo
} from '@renderer/services/recycleBinFeedback'
import { toast } from '@renderer/services/toast'
import { SESSION_UNKNOWN_AGENT_GROUP_ID } from '@renderer/utils/chat/sessionListHelpers'
import { isProtectedBuiltinAgentRole } from '@shared/ai/builtinAgent'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import {
  isAgentNotFoundError,
  isAgentSessionArchiveBusyError,
  isAgentSessionNotFoundError
} from '@shared/ipc/errors/ai'

const logger = loggerService.withContext('useAgentRemoval')

function permanentAgentDeleteError(err: unknown, message: (key: string) => string): Error {
  if (isAgentNotFoundError(err)) return new Error(message('recycle_bin.delete.stale'))
  if (isAgentSessionArchiveBusyError(err)) return new Error(message('recycle_bin.delete.busy'))
  if (err instanceof Error) return err
  return new Error(message('agent.delete.error.failed'))
}

export function useAgentRemoval({
  agents,
  activeSessionId,
  source: { sessions, isFullyLoaded, reload },
  refetchAgents,
  onActiveAgentDeleted
}: {
  agents: readonly AgentEntity[]
  activeSessionId?: string | null
  source: Pick<AgentSessionsSource, 'sessions' | 'isFullyLoaded' | 'reload'>
  refetchAgents: () => Promise<unknown>
  onActiveAgentDeleted?: (agentId: string) => void | Promise<void>
}) {
  const { t } = useTranslation()
  const closeConversationTabs = useCloseConversationTabs()
  const invalidate = useInvalidateCache()
  const [deletingAgentId, setDeletingAgentId] = useState<string | null>(null)
  const agentsRef = useRef(agents)
  const activeSessionIdRef = useRef(activeSessionId)
  const deleteAgentPromptLockRef = useRef(false)
  agentsRef.current = agents
  activeSessionIdRef.current = activeSessionId

  const restoreAgent = useCallback((agentId: string) => ipcApi.request('ai.agent.restore', { agentId }), [])
  const restoreSession = useCallback(
    (sessionId: string) => ipcApi.request('ai.agent.session.restore', { sessionId }),
    []
  )

  const refreshAfterRestore = useCallback(async () => {
    const outcomes = await Promise.allSettled([refetchAgents(), reload()])
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') {
        logger.warn('Failed to refresh Agent resources after restore', {
          err: outcome.reason
        })
      }
    }
  }, [refetchAgents, reload])

  const handleDeleteAgent = useCallback(
    async (agentId: string, mode: 'archive' | 'archive-sessions' | 'permanent' = 'archive') => {
      if (deleteAgentPromptLockRef.current || deletingAgentId) return

      const permanent = mode === 'permanent'
      const deleteSessionsOnly = mode === 'archive-sessions'
      const currentAgent = agentsRef.current.find((agent) => agent.id === agentId)
      const protectedAgent = isProtectedBuiltinAgentRole(currentAgent?.configuration?.builtin_role)
      if (protectedAgent && !deleteSessionsOnly) return
      if (permanent && (!currentAgent || agentId === SESSION_UNKNOWN_AGENT_GROUP_ID)) return

      const agentName = currentAgent?.name ?? t('common.unnamed')

      const performDelete = async (deleteSessions: boolean) => {
        const invalidateAgentResources = async () => {
          const invalidateOutcomes = await Promise.allSettled(
            ['/agents', '/agent-sessions', '/agent-workspaces', '/pins', '/agent-channels'].map((key) =>
              invalidate(key)
            )
          )
          if (invalidateOutcomes.some((outcome) => outcome.status === 'rejected')) {
            logger.warn('Failed to refresh after deleting Agent', { agentId })
          }
        }
        const reloadAgentResources = async () => {
          try {
            await Promise.all([...(deleteSessionsOnly ? [] : [refetchAgents()]), reload()])
          } catch (err) {
            logger.warn('Failed to reload resources after deleting Agent', { agentId, err })
          }
        }
        const refreshAgentResources = async () => {
          await invalidateAgentResources()
          await reloadAgentResources()
        }
        const reconcileDeletedSelection = async (
          deletedSessionIds: string[],
          sessionIdAtStart: string | null | undefined
        ) => {
          const activeSessionIdNow = activeSessionIdRef.current
          const currentSessionWasDeleted = !!activeSessionIdNow && deletedSessionIds.includes(activeSessionIdNow)
          // Empty selection only reconciles when the session active at mutation start was deleted.
          const closedTargetRace =
            !activeSessionIdNow && !!sessionIdAtStart && deletedSessionIds.includes(sessionIdAtStart)
          if (!currentSessionWasDeleted && !closedTargetRace) return

          try {
            await onActiveAgentDeleted?.(agentId)
          } catch (err) {
            logger.warn('Failed to reconcile active Agent after deletion', { agentId, err })
          }
        }

        if (permanent) {
          const liveAgent = agentsRef.current.find((agent) => agent.id === agentId)
          if (
            agentId === SESSION_UNKNOWN_AGENT_GROUP_ID ||
            !liveAgent ||
            isProtectedBuiltinAgentRole(liveAgent.configuration?.builtin_role)
          ) {
            await refreshAgentResources()
            throw new Error(t('recycle_bin.delete.stale'))
          }
        }

        const activeSessionIdWhenMutationStarted = activeSessionIdRef.current
        setDeletingAgentId(agentId)
        let deletionCommitted = false
        try {
          let deletedSessionIds: string[] = []
          let deletionChangedState = false
          try {
            if (deleteSessionsOnly) {
              const result = await ipcApi.request('ai.agent.sessions.delete', { agentId })
              deletedSessionIds = result.deletedIds
              deletionChangedState = deletedSessionIds.length > 0
            } else if (permanent) {
              const result = await ipcApi.request('ai.agent.delete_permanently', {
                agentId,
                deleteSessions
              })
              deletionChangedState = result.deleted
              deletedSessionIds = result.deletedSessionIds ?? []
            } else {
              const result = await ipcApi.request('ai.agent.delete', {
                agentId,
                deleteSessions
              })
              deletionChangedState = result.deleted
              deletedSessionIds = result.deletedSessionIds ?? []
            }
          } catch (err) {
            if (!permanent) throw err
            await refreshAgentResources()
            throw permanentAgentDeleteError(err, t)
          }

          if (permanent) {
            if (!deletionChangedState) {
              await refreshAgentResources()
              throw new Error(t('recycle_bin.delete.stale'))
            }
            deletionCommitted = true
            if (deletedSessionIds.length > 0) closeConversationTabs('agents', deletedSessionIds)
            await reconcileDeletedSelection(deletedSessionIds, activeSessionIdWhenMutationStarted)
            await refreshAgentResources()
            return
          }

          if (deletedSessionIds.length > 0) closeConversationTabs('agents', deletedSessionIds)
          await invalidateAgentResources()
          if (!deletionChangedState) {
            await reloadAgentResources()
            toast.info(t('recycle_bin.already_moved'))
            return
          }

          await reconcileDeletedSelection(deletedSessionIds, activeSessionIdWhenMutationStarted)
          await reloadAgentResources()
          if (deleteSessionsOnly) {
            showRecycleBinBatchUndo({
              itemCount: deletedSessionIds.length,
              onUndo: () =>
                restoreRecycleBinItems({
                  ids: deletedSessionIds,
                  restore: restoreSession,
                  getActive: (id) => dataApiService.get(`/agent-sessions/${id}`),
                  isNotFound: isAgentSessionNotFoundError,
                  refresh: refreshAfterRestore
                })
            })
          } else {
            showRecycleBinUndo({
              itemName: agentName,
              title: t('common.archived', { name: agentName }),
              description: t('agent.archive.related_resources'),
              onUndo: () =>
                restoreRecycleBinUndoGroup({
                  primary: {
                    id: agentId,
                    restore: (id) => restoreAgent(id),
                    isNotFound: isAgentNotFoundError,
                    getActive: (id) => dataApiService.get(`/agents/${id}`)
                  },
                  related: {
                    ids: deletedSessionIds,
                    restore: restoreSession,
                    getActive: (id) => dataApiService.get(`/agent-sessions/${id}`),
                    isNotFound: isAgentSessionNotFoundError
                  },
                  refresh: refreshAfterRestore
                })
            })
          }
        } catch (err) {
          if (deletionCommitted) {
            logger.warn('Agent deletion succeeded but a follow-up failed', { agentId, err })
            return
          }
          logger.error('Failed to delete agent', { agentId, err })
          throw err
        } finally {
          setDeletingAgentId(null)
        }
      }

      deleteAgentPromptLockRef.current = true
      try {
        if (deleteSessionsOnly) {
          await archiveAgentSessionsPopup.show({
            agentName,
            sessionCount: isFullyLoaded ? sessions.filter((session) => session.agentId === agentId).length : undefined,
            t,
            action: () => performDelete(true)
          })
          return
        }

        if (permanent) {
          await permanentDeletePopup.show({
            kind: 'owner',
            type: 'agent',
            name: agentName,
            action: performDelete
          })
          return
        }

        await deleteConversationOwnerPopup.show({ type: 'agent', action: performDelete })
      } finally {
        deleteAgentPromptLockRef.current = false
      }
    },
    [
      closeConversationTabs,
      deletingAgentId,
      invalidate,
      isFullyLoaded,
      onActiveAgentDeleted,
      refreshAfterRestore,
      refetchAgents,
      reload,
      restoreAgent,
      restoreSession,
      sessions,
      t
    ]
  )

  const canPermanentDeleteAgent = useCallback(
    (agentId: string) => {
      if (deleteAgentPromptLockRef.current || deletingAgentId !== null) return false
      if (agentId === SESSION_UNKNOWN_AGENT_GROUP_ID) return false
      const owner = agentsRef.current.find((agent) => agent.id === agentId)
      return !!owner && !isProtectedBuiltinAgentRole(owner.configuration?.builtin_role)
    },
    [deletingAgentId]
  )

  return { deletingAgentId, handleDeleteAgent, canPermanentDeleteAgent }
}
