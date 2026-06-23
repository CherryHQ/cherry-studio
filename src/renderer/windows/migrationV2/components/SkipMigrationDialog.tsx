/**
 * Destructive confirmation for skipping migration.
 *
 * Shared by the introduction "Skip migration" entry and the version-incompatible
 * skip action. The confirm button is destructive and stays disabled for a 10s
 * countdown so the choice is deliberate. Confirming calls the existing
 * `migration:skip-migration` path (via the provided `onConfirm`).
 */

import {
  Alert,
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
      <DialogContent size="default" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t('migration.skip_dialog.title')}</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-4 pt-2">
              <Alert type="error" showIcon={false} className="shadow-none">
                <span className="text-sm leading-relaxed">
                  <strong className="font-semibold">{t('migration.skip_dialog.warning_prefix')}</strong>
                  {t('migration.skip_dialog.warning_body')}
                </span>
              </Alert>
              <ul className="space-y-2 text-foreground-muted text-sm leading-relaxed">
                <li className="flex items-start gap-2">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-destructive" aria-hidden="true" />
                  <span>
                    <strong className="font-medium text-foreground">
                      {t('migration.skip_dialog.points.retained_strong')}
                    </strong>
                    {t('migration.skip_dialog.points.retained_rest')}
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-destructive" aria-hidden="true" />
                  <span>{t('migration.skip_dialog.points.not_visible')}</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-destructive" aria-hidden="true" />
                  <span>
                    {t('migration.skip_dialog.points.skip_before')}
                    <strong className="font-medium text-foreground">
                      {t('migration.skip_dialog.points.skip_strong')}
                    </strong>
                    {t('migration.skip_dialog.points.skip_after')}
                  </span>
                </li>
              </ul>
            </div>
          </DialogDescription>
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
