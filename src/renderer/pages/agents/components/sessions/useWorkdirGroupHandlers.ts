import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { loggerService } from '@logger'
import type { ResourceListGroup } from '@renderer/components/chat/resourceList/base'
import { useInvalidateCache, useMutation } from '@renderer/data/hooks/useDataApi'
import { useCloseConversationTabs } from '@renderer/hooks/tab'
import { ipcApi } from '@renderer/ipc'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import type { SessionListItem, SessionWorkdirDisplayMaps } from '@renderer/utils/chat/sessionListHelpers'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { findLatestActive } from '@renderer/utils/resourceEntity'

const logger = loggerService.withContext('AgentSessions')

interface UseWorkdirGroupHandlersOptions {
  activeSessionId: string | null
  refetchWorkspaces: () => Promise<unknown>
  reload: () => Promise<unknown>
  sessionItems: readonly SessionListItem[]
  setActiveSessionId: (id: string | null) => void
  workdirDisplay: SessionWorkdirDisplayMaps
}

export function useWorkdirGroupHandlers({
  activeSessionId,
  refetchWorkspaces,
  reload,
  sessionItems,
  setActiveSessionId,
  workdirDisplay
}: UseWorkdirGroupHandlersOptions) {
  const { t } = useTranslation()
  const closeConversationTabs = useCloseConversationTabs()
  const invalidate = useInvalidateCache()
  const [deletingWorkspaceGroupId, setDeletingWorkspaceGroupId] = useState<string | null>(null)
  const [renamingWorkspaceGroup, setRenamingWorkspaceGroup] = useState<{
    name: string
    workspaceId: string
  } | null>(null)
  const { trigger: updateWorkspace, isLoading: isUpdatingWorkspace } = useMutation(
    'PATCH',
    '/agent-workspaces/:workspaceId',
    {
      refresh: ['/agent-workspaces', '/agent-sessions']
    }
  )

  const handleDeleteWorkdirGroup = useCallback(
    async (group: ResourceListGroup) => {
      const workspaceId = workdirDisplay.workspaceIdByGroupId.get(group.id)
      if (!workspaceId || deletingWorkspaceGroupId) return

      const sessionIds = sessionItems
        .filter((session) => session.workspaceId === workspaceId)
        .map((session) => session.id)

      const confirmed = await popup.confirm({
        title: t('agent.session.workdir.delete.title'),
        content: t('agent.session.workdir.delete.content'),
        okText: t('common.delete'),
        cancelText: t('common.cancel'),
        centered: true,
        okButtonProps: {
          danger: true
        }
      })
      if (!confirmed) return

      setDeletingWorkspaceGroupId(group.id)

      try {
        const result = await ipcApi.request('ai.agent.workspace.delete', { workspaceId })
        closeConversationTabs('agents', result.deletedIds)
        const affectedSessionIds = new Set(result.deletedIds)

        if (activeSessionId && affectedSessionIds.has(activeSessionId)) {
          const remaining = findLatestActive(sessionItems.filter((session) => !affectedSessionIds.has(session.id)))
          setActiveSessionId(remaining?.id ?? null)
        }

        try {
          await Promise.all([
            ...['/agent-sessions', '/agent-workspaces', '/pins', '/agent-channels'].map((key) => invalidate(key)),
            reload(),
            refetchWorkspaces()
          ])
        } catch (err) {
          logger.warn('Failed to reconcile after deleting workspace group', { err, sessionIds, workspaceId })
        }
        toast.success(t('common.delete_success'))
      } catch (err) {
        logger.error('Failed to delete workspace group', { err, sessionIds, workspaceId })
        toast.error(formatErrorMessageWithPrefix(err, t('agent.session.workdir.delete.error.failed')))
      } finally {
        setDeletingWorkspaceGroupId(null)
      }
    },
    [
      activeSessionId,
      closeConversationTabs,
      deletingWorkspaceGroupId,
      invalidate,
      refetchWorkspaces,
      reload,
      sessionItems,
      setActiveSessionId,
      t,
      workdirDisplay
    ]
  )

  const handleStartRenameWorkdirGroup = useCallback(
    (group: ResourceListGroup) => {
      const workspaceId = workdirDisplay.workspaceIdByGroupId.get(group.id)
      if (!workspaceId) return

      setRenamingWorkspaceGroup({
        name: group.label,
        workspaceId
      })
    },
    [workdirDisplay]
  )

  const handleRenameWorkdirGroup = useCallback(
    async (name: string) => {
      const target = renamingWorkspaceGroup
      const trimmedName = name.trim()
      if (!target || !trimmedName || trimmedName === target.name.trim()) return

      try {
        await updateWorkspace({
          body: { name: trimmedName },
          params: { workspaceId: target.workspaceId }
        })
        toast.success(t('common.saved'))
      } catch (err) {
        logger.error('Failed to rename workspace group', { err, workspaceId: target.workspaceId })
        toast.error(formatErrorMessageWithPrefix(err, t('agent.session.workdir.rename.error.failed')))
      }
    },
    [renamingWorkspaceGroup, t, updateWorkspace]
  )

  const handleOpenWorkdirGroup = useCallback(
    async (workdirPath: string) => {
      try {
        await ipcApi.request('system.shell.open_path', workdirPath)
      } catch (err) {
        toast.error(formatErrorMessageWithPrefix(err, t('files.error.open_path', { path: workdirPath })))
      }
    },
    [t]
  )

  return {
    deletingWorkspaceGroupId,
    handleDeleteWorkdirGroup,
    handleOpenWorkdirGroup,
    handleRenameWorkdirGroup,
    handleStartRenameWorkdirGroup,
    isUpdatingWorkspace,
    renamingWorkspaceGroup,
    setRenamingWorkspaceGroup
  }
}
