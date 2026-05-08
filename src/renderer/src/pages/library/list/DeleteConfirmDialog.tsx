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
  const { t } = useTranslation()
  const { deleteAssistant } = useAssistantMutationsById(resource.id)
  const { deleteAgent } = useAgentMutationsById(resource.id)
  const { deletePrompt } = usePromptMutationsById(resource.id)
  const { uninstallSkill } = useSkillMutationsById(resource.id)
  const [pending, setPending] = useState(false)

  const handleConfirm = useCallback(async () => {
    setPending(true)
    try {
      if (resource.type === 'assistant') {
        await deleteAssistant()
      } else if (resource.type === 'agent') {
        await deleteAgent()
      } else if (resource.type === 'skill') {
        await uninstallSkill()
      } else if (resource.type === 'prompt') {
        await deletePrompt()
      }
    } finally {
      setPending(false)
    }
  }, [resource, deleteAssistant, deleteAgent, uninstallSkill, deletePrompt])

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
