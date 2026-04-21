import { ConfirmDialog } from '@cherrystudio/ui'
import type { FC } from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAssistantMutationsById } from '../adapters/assistantAdapter'
import type { ResourceItem } from '../types'

interface Props {
  resource: ResourceItem | null
  onClose: () => void
}

/**
 * Assistant-list delete confirmation — reuses the existing `assistants.delete.*`
 * i18n keys and the shared Shadcn `ConfirmDialog` (destructive variant). Matches
 * the legacy antd `window.modal.confirm` copy + behaviour while staying within
 * the v2 UI stack.
 */
export const DeleteConfirmDialog: FC<Props> = ({ resource, onClose }) => {
  if (!resource) return null
  return <DeleteDialogBody resource={resource} onClose={onClose} />
}

const DeleteDialogBody: FC<{ resource: ResourceItem; onClose: () => void }> = ({ resource, onClose }) => {
  const { t } = useTranslation()
  // Hook is only instantiated while the dialog is mounted → resource.id is always valid.
  const { deleteAssistant } = useAssistantMutationsById(resource.id)
  const [pending, setPending] = useState(false)

  const handleConfirm = useCallback(async () => {
    if (resource.type !== 'assistant') return
    setPending(true)
    try {
      await deleteAssistant()
    } finally {
      setPending(false)
    }
  }, [resource, deleteAssistant])

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
      title={t('assistants.delete.title')}
      description={t('assistants.delete.content')}
      confirmText={t('common.delete')}
      cancelText={t('common.cancel')}
      destructive
      confirmLoading={pending}
      onConfirm={handleConfirm}
    />
  )
}
