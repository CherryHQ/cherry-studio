import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Checkbox, ConfirmDialog, Label } from '@cherrystudio/ui'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { formatErrorMessage } from '@renderer/utils/error'

export interface DeleteConversationOwnerConfirmDialogProps {
  type: 'agent' | 'assistant'
  permanent?: boolean
  open: boolean
  pending: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (deleteChildren: boolean) => void | Promise<void>
}

export function DeleteConversationOwnerConfirmDialog({
  type,
  permanent = false,
  open,
  pending,
  onOpenChange,
  onConfirm
}: DeleteConversationOwnerConfirmDialogProps) {
  const { t } = useTranslation()
  const checkboxId = useId()
  const [deleteChildren, setDeleteChildren] = useState(false)
  const preventNextCloseRef = useRef(false)
  const checkboxLabel = permanent
    ? t(type === 'agent' ? 'conversation_owner.delete.related_sessions' : 'conversation_owner.delete.related_topics')
    : t(type === 'agent' ? 'conversation_owner.archive.related_sessions' : 'conversation_owner.archive.related_topics')

  const handleConfirm = async () => {
    try {
      await onConfirm(deleteChildren)
    } catch {
      preventNextCloseRef.current = true
    }
  }

  const handleOpenChange = (next: boolean) => {
    if (!next && preventNextCloseRef.current) {
      preventNextCloseRef.current = false
      return
    }
    if (!next && pending) return

    if (!next || !open) {
      setDeleteChildren(false)
    }
    onOpenChange(next)
  }

  return (
    <ConfirmDialog
      open={open}
      title={t(permanent ? 'settings.data.trash.permanent_delete.confirm_title' : 'common.archive')}
      confirmText={t(permanent ? 'common.delete_permanently' : 'common.archive')}
      cancelText={t('common.cancel')}
      cancelDisabled={pending}
      destructive={permanent}
      confirmLoading={pending}
      confirmDisabled={pending}
      onOpenChange={handleOpenChange}
      onConfirm={handleConfirm}
      content={
        <div className="space-y-3">
          {permanent && <p>{t('settings.data.trash.permanent_delete.confirm_content')}</p>}
          <div className="flex items-center gap-2">
            <Checkbox
              id={checkboxId}
              checked={deleteChildren}
              disabled={pending}
              onCheckedChange={(checked) => setDeleteChildren(checked === true)}
            />
            <Label htmlFor={checkboxId}>{checkboxLabel}</Label>
          </div>
        </div>
      }
    />
  )
}

export interface DeleteConversationOwnerPopupParams {
  type: 'agent' | 'assistant'
  permanent?: boolean
  action: (deleteChildren: boolean) => void | Promise<void>
}

function PopupContainer({
  open,
  resolve,
  type,
  permanent,
  action
}: DeleteConversationOwnerPopupParams & PopupInjectedProps<boolean>) {
  const { t } = useTranslation()
  const [pending, setPending] = useState(false)

  const handleOpenChange = (next: boolean) => {
    if (!next && !pending) {
      resolve(false)
    }
  }

  const handleConfirm = async (deleteChildren: boolean) => {
    setPending(true)
    try {
      await action(deleteChildren)
    } catch (error) {
      toast.error({ title: t('common.error'), description: formatErrorMessage(error) })
      setPending(false)
      throw error
    }
    resolve(true)
  }

  return (
    <DeleteConversationOwnerConfirmDialog
      type={type}
      permanent={permanent}
      open={open}
      pending={pending}
      onOpenChange={handleOpenChange}
      onConfirm={handleConfirm}
    />
  )
}

export const deleteConversationOwnerPopup = createPopup<DeleteConversationOwnerPopupParams, boolean>(PopupContainer, {
  dismissResult: false
})
