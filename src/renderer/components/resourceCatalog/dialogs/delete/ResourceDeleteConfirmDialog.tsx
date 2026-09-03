import { ConfirmDialog } from '@cherrystudio/ui'
import { dataApiService } from '@renderer/data/DataApiService'
import { useInvalidateCache, useMutation } from '@renderer/data/hooks/useDataApi'
import {
  useAssistantMutationsById,
  usePromptMutationsById,
  useSkillMutationsById
} from '@renderer/hooks/resourceCatalog'
import { useCloseConversationTabs } from '@renderer/hooks/tab'
import { ipcApi } from '@renderer/ipc'
import { showRecycleBinBatchUndo, showRecycleBinUndo } from '@renderer/services/recycleBinFeedback'
import { toast } from '@renderer/services/toast'
import type { ResourceItem } from '@renderer/types/resourceCatalog'
import { getErrorMessage } from '@renderer/utils/error'
import { isProtectedBuiltinAgentRole } from '@shared/ai/builtinAgent'
import { isDataApiNotFoundError } from '@shared/data/api/errors'
import type { FC } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  resource: ResourceItem | null
  onClose: () => void
}

/**
 * Delete confirmation for library resources. Dispatches the destructive
 * action by `resource.type` — assistants and agents go through their
 * domain owner, while skills retain their IPC-backed uninstall behavior.
 */
export const ResourceDeleteConfirmDialog: FC<Props> = ({ resource, onClose }) => {
  if (!resource) return null
  return <DeleteDialogBody resource={resource} onClose={onClose} />
}

const DeleteDialogBody: FC<{ resource: ResourceItem; onClose: () => void }> = ({ resource, onClose }) => {
  if (resource.type === 'assistant') return <AssistantDeleteDialog resource={resource} onClose={onClose} />
  if (resource.type === 'agent') return <AgentDeleteDialog resource={resource} onClose={onClose} />
  if (resource.type === 'skill') return <SkillDeleteDialog resource={resource} onClose={onClose} />
  return <PromptDeleteDialog resource={resource} onClose={onClose} />
}

const AssistantDeleteDialog: FC<{ resource: Extract<ResourceItem, { type: 'assistant' }>; onClose: () => void }> = ({
  resource,
  onClose
}) => {
  const { t } = useTranslation()
  const { deleteAssistant } = useAssistantMutationsById(resource.id)
  const invalidate = useInvalidateCache()
  const closeConversationTabs = useCloseConversationTabs()
  const { trigger: restoreAssistant } = useMutation('POST', '/assistants/:id/restore', {
    refresh: ['/assistants', '/assistants/*', '/topics']
  })
  const refreshAffected = useCallback(
    () =>
      Promise.allSettled(['/assistants', '/assistants/*', '/topics'].map((key) => invalidate(key))).then(
        () => undefined
      ),
    [invalidate]
  )
  const onDelete = useCallback(async () => {
    try {
      const result = await deleteAssistant({ deleteTopics: true })
      await refreshAffected()
      if (!result.deleted) {
        toast.info(t('recycle_bin.already_moved'))
        return
      }
      closeConversationTabs('assistants', result.deletedTopicIds ?? [])
    } catch (error) {
      if (!isDataApiNotFoundError(error)) throw error
      await refreshAffected()
      toast.info(t('recycle_bin.already_moved'))
      return
    }

    showRecycleBinUndo({
      itemName: resource.name,
      onUndo: async () => {
        try {
          await restoreAssistant({ params: { id: resource.id } })
        } catch (error) {
          if (!isDataApiNotFoundError(error)) throw error
          await refreshAffected()
          try {
            await dataApiService.get(`/assistants/${resource.id}`)
            return
          } catch {
            throw error
          }
        }
        await refreshAffected()
      }
    })
  }, [closeConversationTabs, deleteAssistant, refreshAffected, resource.id, resource.name, restoreAssistant, t])

  return <DeleteDialogContent resource={resource} onClose={onClose} onDelete={onDelete} />
}

const AgentDeleteDialog: FC<{ resource: Extract<ResourceItem, { type: 'agent' }>; onClose: () => void }> = ({
  resource,
  onClose
}) => {
  const { t } = useTranslation()
  const invalidate = useInvalidateCache()
  const closeConversationTabs = useCloseConversationTabs()
  const deleteTasksOnly = isProtectedBuiltinAgentRole(resource.raw.configuration?.builtin_role)
  const { trigger: restoreAgent } = useMutation('POST', '/agents/:agentId/restore', {
    refresh: ['/agents', '/agents/*', '/agent-sessions']
  })
  const { trigger: restoreSession } = useMutation('POST', '/agent-sessions/:sessionId/restore', {
    refresh: ['/agent-sessions']
  })
  const refreshAffected = useCallback(
    () =>
      Promise.allSettled(['/agents', '/agents/*', '/agent-sessions'].map((key) => invalidate(key))).then(
        () => undefined
      ),
    [invalidate]
  )
  const onDelete = useCallback(async () => {
    if (deleteTasksOnly) {
      const result = await ipcApi.request('ai.agent.sessions.delete', { agentId: resource.id })
      const deletedSessionIds = [...result.deletedIds]
      await refreshAffected()
      if (deletedSessionIds.length === 0) {
        toast.info(t('recycle_bin.already_moved'))
        return
      }

      closeConversationTabs('agents', deletedSessionIds)
      showRecycleBinBatchUndo({
        itemCount: deletedSessionIds.length,
        onUndo: async () => {
          const outcomes = await Promise.allSettled(
            deletedSessionIds.map((sessionId) => restoreSession({ params: { sessionId } }))
          )
          await refreshAffected()
          const activeAfterNotFound = await Promise.all(
            outcomes.map(async (outcome, index) => {
              if (outcome.status === 'fulfilled' || !isDataApiNotFoundError(outcome.reason)) return false
              try {
                await dataApiService.get(`/agent-sessions/${deletedSessionIds[index]}`)
                return true
              } catch {
                return false
              }
            })
          )
          return outcomes.reduce(
            (summary, outcome, index) => {
              const sessionId = deletedSessionIds[index]
              if (outcome.status === 'fulfilled' || activeAfterNotFound[index]) summary.restored.push(sessionId)
              else summary.failed.push({ id: sessionId, error: getErrorMessage(outcome.reason) })
              return summary
            },
            { restored: [] as string[], failed: [] as Array<{ id: string; error: string }> }
          )
        }
      })
      return
    }

    const result = await ipcApi.request('ai.agent.delete', { agentId: resource.id, deleteSessions: true })
    await refreshAffected()
    if (!result.deleted) {
      toast.info(t('recycle_bin.already_moved'))
      return
    }

    closeConversationTabs('agents', result.deletedSessionIds ?? [])
    showRecycleBinUndo({
      itemName: resource.name,
      onUndo: async () => {
        try {
          await restoreAgent({ params: { agentId: resource.id } })
        } catch (error) {
          if (!isDataApiNotFoundError(error)) throw error
          await refreshAffected()
          try {
            await dataApiService.get(`/agents/${resource.id}`)
            return
          } catch {
            throw error
          }
        }
        await refreshAffected()
      }
    })
  }, [
    closeConversationTabs,
    deleteTasksOnly,
    refreshAffected,
    resource.id,
    resource.name,
    restoreAgent,
    restoreSession,
    t
  ])

  return (
    <DeleteDialogContent
      resource={resource}
      onClose={onClose}
      onDelete={onDelete}
      description={deleteTasksOnly ? undefined : t('recycle_bin.move.agent_tasks_warning')}
    />
  )
}

const SkillDeleteDialog: FC<{ resource: Extract<ResourceItem, { type: 'skill' }>; onClose: () => void }> = ({
  resource,
  onClose
}) => {
  const { uninstallSkill } = useSkillMutationsById(resource.id)
  return <DeleteDialogContent resource={resource} onClose={onClose} onDelete={uninstallSkill} />
}

const PromptDeleteDialog: FC<{ resource: Extract<ResourceItem, { type: 'prompt' }>; onClose: () => void }> = ({
  resource,
  onClose
}) => {
  const { deletePrompt } = usePromptMutationsById(resource.id)
  return <DeleteDialogContent resource={resource} onClose={onClose} onDelete={deletePrompt} />
}

const DeleteDialogContent: FC<{
  resource: ResourceItem
  onClose: () => void
  onDelete: () => Promise<void>
  description?: string
}> = ({ resource, onClose, onDelete, description: descriptionOverride }) => {
  const { t } = useTranslation()
  const [pending, setPending] = useState(false)

  const handleConfirm = useCallback(async () => {
    setPending(true)
    try {
      await onDelete()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.delete_failed'))
      throw error
    } finally {
      setPending(false)
    }
  }, [onDelete, t])

  const { title, description, confirmText } = useMemo(() => {
    if (resource.type === 'agent' || resource.type === 'assistant') {
      return {
        title: t('recycle_bin.move.confirm_title'),
        description: descriptionOverride,
        confirmText: t('recycle_bin.move.confirm_action')
      }
    }
    if (resource.type === 'skill') {
      return {
        title: t('library.delete.skill.title'),
        description: t('library.delete.skill.content'),
        confirmText: t('library.action.uninstall')
      }
    }
    if (resource.type === 'prompt') {
      return {
        title: t('settings.prompts.delete'),
        description: t('settings.prompts.deleteConfirm'),
        confirmText: t('common.delete')
      }
    }
    return { title: '', description: undefined, confirmText: '' }
  }, [descriptionOverride, resource.type, t])

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
      title={title}
      description={description}
      confirmText={confirmText}
      cancelText={t('common.cancel')}
      destructive
      confirmLoading={pending}
      onConfirm={handleConfirm}
    />
  )
}
