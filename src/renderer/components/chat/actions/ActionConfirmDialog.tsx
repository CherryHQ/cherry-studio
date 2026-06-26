import { ConfirmDialog } from '@cherrystudio/ui'

import type { ResolvedActionConfirm } from './actionTypes'

export interface ActionConfirmDialogProps {
  confirm?: ResolvedActionConfirm
  contentClassName?: string
  overlayClassName?: string
  open: boolean
  onConfirm: () => void | Promise<void>
  onOpenChange: (open: boolean) => void
}

export function ActionConfirmDialog({
  confirm,
  contentClassName,
  overlayClassName,
  open,
  onConfirm,
  onOpenChange
}: ActionConfirmDialogProps) {
  if (!confirm) return null

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      contentClassName={contentClassName}
      overlayClassName={overlayClassName}
      title={confirm.title}
      description={confirm.description}
      content={confirm.content}
      confirmText={confirm.confirmText}
      cancelText={confirm.cancelText}
      destructive={confirm.destructive}
      onConfirm={onConfirm}
    />
  )
}
