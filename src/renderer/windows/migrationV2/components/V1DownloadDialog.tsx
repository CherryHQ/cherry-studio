/**
 * v1 download offer.
 *
 * Opens on a failure that follows a retry — the point where the user has exhausted the
 * in-app options and needs a way off the upgrade. Dismissing leaves the failure screen's
 * inline entry in place, so the download path is never lost.
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
import { ExternalLink } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDownload: () => void
}

export const V1DownloadDialog: FC<Props> = ({ open, onOpenChange, onDownload }) => {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{t('migration.error.v1_fallback.title')}</DialogTitle>
          <DialogDescription>{t('migration.error.v1_fallback.description')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{t('migration.error.v1_fallback.dismiss')}</Button>
          </DialogClose>
          <Button variant="emphasis" onClick={onDownload}>
            <ExternalLink size={13} />
            {t('migration.error.v1_fallback.download')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
