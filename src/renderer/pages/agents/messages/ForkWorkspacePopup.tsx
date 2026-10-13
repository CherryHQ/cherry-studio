import { useTranslation } from 'react-i18next'

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cherrystudio/ui'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'

type Choice = 'shared' | 'copy' | null

function ForkWorkspaceDialog({ open, resolve }: PopupInjectedProps<Choice>) {
  const { t } = useTranslation()
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) resolve(null)
      }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('workspace_copy.fork_title')}</DialogTitle>
          <DialogDescription>
            {t('workspace_copy.description')} {t('workspace_copy.fork_current_files')}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => resolve(null)}>
            {t('common.cancel')}
          </Button>
          <Button variant="outline" onClick={() => resolve('shared')}>
            {t('workspace_copy.share')}
          </Button>
          <Button onClick={() => resolve('copy')}>{t('workspace_copy.create')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export const forkWorkspacePopup = createPopup<Record<string, never>, Choice>(ForkWorkspaceDialog, {
  dismissResult: null
})
