import { ConfirmDialog } from '@cherrystudio/ui'
import type { FC } from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAgentMutationsById } from '../adapters/agentAdapter'
import { useAssistantMutationsById } from '../adapters/assistantAdapter'
import type { ResourceItem } from '../types'

interface Props {
  resource: ResourceItem | null
  onClose: () => void
}

/**
 * Delete confirmation for library resources. Dispatches the delete mutation
 * by `resource.type` — assistants go through `useAssistantMutationsById`,
 * agents through `useAgentMutationsById`. Skills are read-only from the
 * DataApi, so a skill resource is a no-op (the menu entry is also hidden).
 */
export const DeleteConfirmDialog: FC<Props> = ({ resource, onClose }) => {
  if (!resource) return null
  return <DeleteDialogBody resource={resource} onClose={onClose} />
}

const DeleteDialogBody: FC<{ resource: ResourceItem; onClose: () => void }> = ({ resource, onClose }) => {
  const { t } = useTranslation()
  const { deleteAssistant } = useAssistantMutationsById(resource.id)
  const { deleteAgent } = useAgentMutationsById(resource.id)
  const [pending, setPending] = useState(false)

  const handleConfirm = useCallback(async () => {
    setPending(true)
    try {
      if (resource.type === 'assistant') {
        await deleteAssistant()
      } else if (resource.type === 'agent') {
        await deleteAgent()
      }
    } finally {
      setPending(false)
    }
  }, [resource, deleteAssistant, deleteAgent])

  const title = resource.type === 'agent' ? t('library.delete.agent.title') : t('assistants.delete.title')
  const description = resource.type === 'agent' ? t('library.delete.agent.content') : t('assistants.delete.content')

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
      title={title}
      description={description}
      confirmText={t('common.delete')}
      cancelText={t('common.cancel')}
      destructive
      confirmLoading={pending}
      onConfirm={handleConfirm}
    />
  )
}
