import { ConfirmDialog } from '@cherrystudio/ui'
import type { FC } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAgentMutationsById } from '../adapters/agentAdapter'
import { useAssistantMutationsById } from '../adapters/assistantAdapter'
import { usePromptMutationsById } from '../adapters/promptAdapter'
import { useSkillMutationsById } from '../adapters/skillAdapter'
import type { ResourceItem } from '../types'

interface Props {
  resource: ResourceItem | null
  onClose: () => void
}

/**
 * Delete confirmation for library resources. Dispatches the destructive
 * action by `resource.type` — assistants and agents go through their
 * DataApi `useXxxMutationsById.deleteXxx`, skills go through the IPC-backed
 * `useSkillMutationsById.uninstallSkill` (skills can't ride DataApi for
 * write operations because uninstall touches filesystem symlinks).
 */
export const DeleteConfirmDialog: FC<Props> = ({ resource, onClose }) => {
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
  const { deleteAssistant } = useAssistantMutationsById(resource.id)
  return <DeleteDialogContent resource={resource} onClose={onClose} onDelete={deleteAssistant} />
}

const AgentDeleteDialog: FC<{ resource: Extract<ResourceItem, { type: 'agent' }>; onClose: () => void }> = ({
  resource,
  onClose
}) => {
  const { deleteAgent } = useAgentMutationsById(resource.id)
  return <DeleteDialogContent resource={resource} onClose={onClose} onDelete={deleteAgent} />
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

const DeleteDialogContent: FC<{ resource: ResourceItem; onClose: () => void; onDelete: () => Promise<void> }> = ({
  resource,
  onClose,
  onDelete
}) => {
  const { t } = useTranslation()
  const [pending, setPending] = useState(false)

  const handleConfirm = useCallback(async () => {
    setPending(true)
    try {
      await onDelete()
    } catch (error) {
      window.toast.error(error instanceof Error ? error.message : t('common.delete_failed'))
      throw error
    } finally {
      setPending(false)
    }
  }, [onDelete, t])

  const { title, description, confirmText } = useMemo(() => {
    if (resource.type === 'agent') {
      return {
        title: t('library.delete.agent.title'),
        description: t('library.delete.agent.content'),
        confirmText: t('common.delete')
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
    return {
      title: t('assistants.delete.title'),
      description: t('assistants.delete.content'),
      confirmText: t('common.delete')
    }
  }, [resource.type, t])

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
