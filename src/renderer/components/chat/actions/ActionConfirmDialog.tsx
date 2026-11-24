import { ConfirmDialog } from '@cherrystudio/ui'
import { useExitPresence } from '@renderer/hooks/useExitPresence'

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
  const { value: retainedConfirm } = useExitPresence(confirm ?? null)
  if (!retainedConfirm) return null

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      contentClassName={contentClassName}
      overlayClassName={overlayClassName}
      title={retainedConfirm.title}
      description={retainedConfirm.description}
      content={retainedConfirm.content}
      confirmText={retainedConfirm.confirmText}
      cancelText={retainedConfirm.cancelText}
      destructive={retainedConfirm.destructive}
      onConfirm={onConfirm}
    />
  )
}
