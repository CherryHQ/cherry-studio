/**
 * In-flow close confirmation.
 *
 * Shown when the user tries to close the migration window during an in-flow stage
 * (backup choice / backup progress / backup confirmed / migration — main intercepts the
 * native close and asks the renderer to open this dialog). "Continue" is the prominent
 * default and keeps the window; "Quit" exits the app (via the provided `onConfirm`).
 * Escape / backdrop dismiss == continue, so an accidental dismissal never quits.
 */

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cherrystudio/ui'
import { type FC, useRef } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

export const CloseMigrationDialog: FC<Props> = ({ open, onOpenChange, onConfirm }) => {
  const { t } = useTranslation()
  const continueRef = useRef<HTMLButtonElement>(null)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="sm"
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          // Radix would otherwise focus the first button: destructive Quit.
          event.preventDefault()
          continueRef.current?.focus()
        }}>
        <DialogHeader>
          <DialogTitle>{t('migration.window.confirm_close.title')}</DialogTitle>
          <DialogDescription>{t('migration.window.confirm_close.message')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="destructive" onClick={onConfirm}>
            {t('migration.window.confirm_close.quit')}
          </Button>
          <Button ref={continueRef} variant="emphasis" onClick={() => onOpenChange(false)}>
            {t('migration.window.confirm_close.continue')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
