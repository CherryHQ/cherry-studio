import { Button } from '@cherrystudio/ui/components/primitives/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cherrystudio/ui/components/primitives/dialog'
import * as React from 'react'

interface ConfirmDialogProps {
  /** Controls the open state of the dialog */
  open?: boolean
  /** Callback when open state changes */
  onOpenChange?: (open: boolean) => void
  /** Dialog title */
  title: React.ReactNode
  /** Dialog description */
  description?: React.ReactNode
  /** Custom content below description */
  content?: React.ReactNode
  /** Confirm button text */
  confirmText?: string
  /** Cancel button text */
  cancelText?: string
  /** Callback when confirm button is clicked */
  onConfirm?: () => void | Promise<void>
  /** Whether this is a destructive action (e.g., delete) */
  destructive?: boolean
  /** Loading state for confirm button */
  confirmLoading?: boolean
  /** Whether the confirm action is unavailable */
  confirmDisabled?: boolean
  /** Optional className for DialogContent */
  contentClassName?: string
  /** Optional className for DialogOverlay */
  overlayClassName?: string
}

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  content,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  destructive = false,
  confirmLoading = false,
  confirmDisabled = false,
  contentClassName,
  overlayClassName
}: ConfirmDialogProps) {
  const confirmingRef = React.useRef(false)

  const handleConfirm = React.useCallback(async () => {
    if (confirmingRef.current) return
    confirmingRef.current = true
    try {
      await onConfirm?.()
      onOpenChange?.(false)
    } catch {
      // The consumer owns error reporting. A rejected confirmation keeps the
      // dialog open and must not escape React's click handler as an unhandled rejection.
    } finally {
      confirmingRef.current = false
    }
  }, [onConfirm, onOpenChange])

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && (confirmLoading || confirmingRef.current)) return
      onOpenChange?.(nextOpen)
    },
    [confirmLoading, onOpenChange]
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        motion="fade-scale"
        showCloseButton={false}
        closeOnOverlayClick={!confirmLoading}
        className={contentClassName}
        overlayClassName={overlayClassName}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {content}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={confirmLoading}>
              {cancelText}
            </Button>
          </DialogClose>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={handleConfirm}
            loading={confirmLoading}
            disabled={confirmDisabled}>
            {confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { ConfirmDialog, type ConfirmDialogProps }
