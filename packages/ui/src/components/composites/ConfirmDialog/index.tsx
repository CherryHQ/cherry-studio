import { cn } from '@cherrystudio/ui/lib/utils'
import * as React from 'react'

import { Button } from '../../primitives/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../../primitives/dialog'

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
  confirmLoading = false
}: ConfirmDialogProps) {
  const handleConfirm = React.useCallback(async () => {
    await onConfirm?.()
    onOpenChange?.(false)
  }, [onConfirm, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="w-[300px] gap-0 rounded-xl bg-popover p-4 shadow-2xl sm:max-w-none">
        <DialogHeader className="gap-0 text-left">
          <DialogTitle className="mb-1 text-xs leading-4 font-normal text-foreground">{title}</DialogTitle>
          {description && (
            <DialogDescription className="mb-3 text-[11px] leading-4 text-muted-foreground/50">
              {description}
            </DialogDescription>
          )}
        </DialogHeader>
        {content}
        <DialogFooter className={cn('flex-row justify-end gap-1.5', content && 'mt-3')}>
          <DialogClose asChild>
            <Button
              variant="ghost"
              className="h-6 min-h-6 rounded-md px-2.5 text-[11px] font-normal text-muted-foreground shadow-none hover:bg-accent hover:text-foreground">
              {cancelText}
            </Button>
          </DialogClose>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            className={cn(
              'h-6 min-h-6 rounded-md px-2.5 text-[11px] font-normal shadow-none',
              destructive && 'bg-red-500 text-white hover:bg-red-600'
            )}
            onClick={handleConfirm}
            loading={confirmLoading}>
            {confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { ConfirmDialog, type ConfirmDialogProps }
