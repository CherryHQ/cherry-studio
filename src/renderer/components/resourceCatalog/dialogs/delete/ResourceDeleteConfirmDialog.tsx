import type { FC } from 'react'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { DeleteConversationOwnerConfirmDialog } from '@renderer/components/chat/DeleteConversationOwnerConfirmDialog'
import { dataApiService } from '@renderer/data/DataApiService'
import { useInvalidateCache, useMutation } from '@renderer/data/hooks/useDataApi'
import {
  useAssistantMutationsById,
  usePromptMutationsById,
  useSkillMutationsById
} from '@renderer/hooks/resourceCatalog'
import { useCloseConversationTabs } from '@renderer/hooks/tab'
import { ipcApi } from '@renderer/ipc'
import { restoreRecycleBinUndoGroup, showRecycleBinUndo } from '@renderer/services/recycleBinFeedback'
import { toast } from '@renderer/services/toast'
import type { ResourceItem } from '@renderer/types/resourceCatalog'
import { isAgentNotFoundError, isAgentSessionNotFoundError } from '@shared/ipc/errors/ai'
import { isTrashTargetNotFoundError, isTrashTopicBusyError } from '@shared/ipc/errors/trash'

const logger = loggerService.withContext('ResourceDeleteConfirmDialog')

interface Props {
  resource: ResourceItem | null
  permanent?: boolean
  onClose: () => void
}

/**
 * Delete confirmation for library resources. Dispatches the destructive
 * action by `resource.type` — assistants and agents go through their
 * domain owner, while skills retain their IPC-backed uninstall behavior.
 */
export const ResourceDeleteConfirmDialog: FC<Props> = ({ resource, onClose, permanent = false }) => {
  if (!resource) return null
  return <DeleteDialogBody resource={resource} onClose={onClose} permanent={permanent} />
}

const DeleteDialogBody: FC<{ resource: ResourceItem; onClose: () => void; permanent: boolean }> = ({
  resource,
  onClose,
  permanent
}) => {
  if (resource.type === 'assistant')
    return <AssistantDeleteDialog resource={resource} onClose={onClose} permanent={permanent} />
  if (resource.type === 'agent')
    return <AgentDeleteDialog resource={resource} onClose={onClose} permanent={permanent} />
  if (resource.type === 'skill') return <SkillDeleteDialog resource={resource} onClose={onClose} />
  return <PromptDeleteDialog resource={resource} onClose={onClose} />
}

const AssistantDeleteDialog: FC<{
  resource: Extract<ResourceItem, { type: 'assistant' }>
  onClose: () => void
  permanent: boolean
}> = ({ resource, permanent, onClose }) => {
  const { t } = useTranslation()
  const { deleteAssistant } = useAssistantMutationsById(resource.id)
  const invalidate = useInvalidateCache()
  const closeConversationTabs = useCloseConversationTabs()
  const { trigger: restoreAssistant } = useMutation('POST', '/assistants/:id/restore', {
    refresh: ['/assistants', '/assistants/*']
  })
  const { trigger: restoreTopic } = useMutation('POST', '/topics/:id/restore', { refresh: ['/topics'] })
  const refreshAffected = useCallback(async () => {
    const outcomes = await Promise.allSettled(['/assistants', '/assistants/*', '/topics'].map((key) => invalidate(key)))
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') {
        logger.warn('Failed to refresh Assistant resources after catalog deletion', { err: outcome.reason })
      }
    }
  }, [invalidate])
  const onDelete = useCallback(
    async (deleteTopics: boolean) => {
      let deletedTopicIds: string[] = []
      try {
        const result = await deleteAssistant({ deleteTopics, permanent })
        await refreshAffected()
        if (!result.deleted) {
          toast.info(t('recycle_bin.already_moved'))
          return
        }
        deletedTopicIds = result.deletedTopicIds ?? []
        if (deletedTopicIds.length > 0) closeConversationTabs('assistants', deletedTopicIds)
      } catch (error) {
        if (permanent || !isTrashTargetNotFoundError(error)) throw error
        await refreshAffected()
        toast.info(t('recycle_bin.already_moved'))
        return
      }

      if (permanent) {
        toast.success(t('settings.data.trash.permanent_delete.success'))
        return
      }
      showRecycleBinUndo({
        itemName: resource.name,
        onUndo: () =>
          restoreRecycleBinUndoGroup({
            primary: {
              id: resource.id,
              restore: (id) => restoreAssistant({ params: { id } }),
              getActive: (id) => dataApiService.get(`/assistants/${id}`)
            },
            related: {
              ids: deletedTopicIds,
              restore: (id) => restoreTopic({ params: { id } }),
              getActive: (id) => dataApiService.get(`/topics/${id}`)
            },
            refresh: refreshAffected
          })
      })
    },
    [
      closeConversationTabs,
      deleteAssistant,
      permanent,
      refreshAffected,
      resource.id,
      resource.name,
      restoreAssistant,
      restoreTopic,
      t
    ]
  )

  return (
    <ConversationOwnerDeleteDialogContent
      resource={resource}
      onClose={onClose}
      onDelete={onDelete}
      permanent={permanent}
    />
  )
}

const AgentDeleteDialog: FC<{
  resource: Extract<ResourceItem, { type: 'agent' }>
  onClose: () => void
  permanent: boolean
}> = ({ resource, permanent, onClose }) => {
  const { t } = useTranslation()
  const invalidate = useInvalidateCache()
  const closeConversationTabs = useCloseConversationTabs()
  const restoreAgent = useCallback((agentId: string) => ipcApi.request('ai.agent.restore', { agentId }), [])
  const restoreSession = useCallback(
    (sessionId: string) => ipcApi.request('ai.agent.session.restore', { sessionId }),
    []
  )
  const refreshAffected = useCallback(async () => {
    const outcomes = await Promise.allSettled(['/agents', '/agents/*', '/agent-sessions'].map((key) => invalidate(key)))
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') {
        logger.warn('Failed to refresh Agent resources after catalog deletion', { err: outcome.reason })
      }
    }
  }, [invalidate])
  const onDelete = useCallback(
    async (deleteSessions: boolean) => {
      const result = await ipcApi.request(permanent ? 'ai.agent.delete_permanently' : 'ai.agent.delete', {
        agentId: resource.id,
        deleteSessions
      })
      await refreshAffected()
      if (!result.deleted) {
        toast.info(t('recycle_bin.already_moved'))
        return
      }

      const deletedSessionIds = result.deletedSessionIds ?? []
      if (deletedSessionIds.length > 0) closeConversationTabs('agents', deletedSessionIds)
      if (permanent) {
        toast.success(t('settings.data.trash.permanent_delete.success'))
        return
      }
      showRecycleBinUndo({
        itemName: resource.name,
        title: t('common.archived', { name: resource.name }),
        description: t('agent.archive.related_resources'),
        onUndo: () =>
          restoreRecycleBinUndoGroup({
            primary: {
              id: resource.id,
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
            refresh: refreshAffected
          })
      })
    },
    [closeConversationTabs, permanent, refreshAffected, resource.id, resource.name, restoreAgent, restoreSession, t]
  )

  return (
    <ConversationOwnerDeleteDialogContent
      resource={resource}
      onClose={onClose}
      onDelete={onDelete}
      permanent={permanent}
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
  resource: Extract<ResourceItem, { type: 'skill' | 'prompt' }>
  onClose: () => void
  onDelete: () => Promise<void>
}> = ({ resource, onClose, onDelete }) => {
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

  const title = t(resource.type === 'skill' ? 'library.delete.skill.title' : 'settings.prompts.delete')
  const description = t(resource.type === 'skill' ? 'library.delete.skill.content' : 'settings.prompts.deleteConfirm')
  const confirmText = t(resource.type === 'skill' ? 'library.action.uninstall' : 'common.delete')

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

const ConversationOwnerDeleteDialogContent: FC<{
  resource: Extract<ResourceItem, { type: 'agent' | 'assistant' }>
  permanent: boolean
  onClose: () => void
  onDelete: (deleteChildren: boolean) => Promise<void>
}> = ({ resource, onClose, onDelete, permanent }) => {
  const { t } = useTranslation()
  const [pending, setPending] = useState(false)
  const completedRef = useRef(false)

  const handleConfirm = useCallback(
    async (deleteChildren: boolean) => {
      setPending(true)
      try {
        await onDelete(deleteChildren)
        completedRef.current = true
        onClose()
      } catch (error) {
        if (!permanent && isTrashTopicBusyError(error)) toast.info(t('recycle_bin.move.blocked_generation'))
        else toast.error(error instanceof Error ? error.message : t('common.delete_failed'))
        throw error
      } finally {
        setPending(false)
      }
    },
    [onClose, onDelete, permanent, t]
  )

  return (
    <DeleteConversationOwnerConfirmDialog
      key={`${resource.type}:${resource.id}`}
      type={resource.type}
      permanent={permanent}
      open
      pending={pending}
      onOpenChange={(open) => {
        if (!open && !pending && !completedRef.current) onClose()
      }}
      onConfirm={handleConfirm}
    />
  )
}
