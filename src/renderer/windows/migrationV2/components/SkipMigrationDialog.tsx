/**
 * Destructive confirmation for skipping migration.
 *
 * Shared by the introduction "Skip migration" entry and the version-incompatible
 * skip action. The confirm button is destructive and stays disabled for a 10s
 * countdown so the choice is deliberate. Confirming calls the existing
 * `migration:skip-migration` path (via the provided `onConfirm`).
 */

import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cherrystudio/ui'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const COUNTDOWN_SECONDS = 10

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

export const SkipMigrationDialog: React.FC<Props> = ({ open, onOpenChange, onConfirm }) => {
  const { t } = useTranslation()
  const [seconds, setSeconds] = useState(COUNTDOWN_SECONDS)

  useEffect(() => {
    if (!open) {
      setSeconds(COUNTDOWN_SECONDS)
      return
    }

    setSeconds(COUNTDOWN_SECONDS)
    const timer = setInterval(() => {
      setSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(timer)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [open])

  const counting = seconds > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t('migration.skip_dialog.title')}</DialogTitle>
          <DialogDescription>{t('migration.skip_dialog.body')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{t('migration.skip_dialog.cancel')}</Button>
          </DialogClose>
          <Button variant="destructive" disabled={counting} onClick={onConfirm}>
            {counting ? t('migration.skip_dialog.confirm_countdown', { seconds }) : t('migration.skip_dialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
