import { Checkbox, ConfirmDialog, Label } from '@cherrystudio/ui'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { formatErrorMessage } from '@renderer/utils/error'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface DeleteConversationOwnerConfirmDialogProps {
  type: 'agent' | 'assistant'
  open: boolean
  pending: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (deleteChildren: boolean) => void | Promise<void>
}

export function DeleteConversationOwnerConfirmDialog({
  type,
  open,
  pending,
  onOpenChange,
  onConfirm
}: DeleteConversationOwnerConfirmDialogProps) {
  const { t } = useTranslation()
  const checkboxId = useId()
  const [deleteChildren, setDeleteChildren] = useState(false)
  const preventNextCloseRef = useRef(false)
  const checkboxLabel = t(type === 'agent' ? 'recycle_bin.move.related_sessions' : 'recycle_bin.move.related_topics')

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
      title={t('recycle_bin.move.confirm_title')}
      confirmText={t('recycle_bin.move.confirm_action')}
      cancelText={t('common.cancel')}
      destructive
      confirmLoading={pending}
      confirmDisabled={pending}
      onOpenChange={handleOpenChange}
      onConfirm={handleConfirm}
      content={
        <div className="flex items-center gap-2">
          <Checkbox
            id={checkboxId}
            checked={deleteChildren}
            disabled={pending}
            onCheckedChange={(checked) => setDeleteChildren(checked === true)}
          />
          <Label htmlFor={checkboxId}>{checkboxLabel}</Label>
        </div>
      }
    />
  )
}

export interface DeleteConversationOwnerPopupParams {
  type: 'agent' | 'assistant'
  action: (deleteChildren: boolean) => void | Promise<void>
}

function PopupContainer({
  open,
  resolve,
  type,
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
