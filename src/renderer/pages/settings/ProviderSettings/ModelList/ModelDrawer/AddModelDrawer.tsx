import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import type { UniqueModelId } from '@shared/data/types/model'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import AddModelFormPanel, { type AddModelDrawerFooterBinding } from './AddModelFormPanel'
import type { AddModelDrawerPrefill } from './types'

interface AddModelDrawerProps {
  providerId: string
  open: boolean
  prefill: AddModelDrawerPrefill | null
  onClose: () => void
  onSuccess?: (modelIds: UniqueModelId[]) => void
  showPurposeSelection?: boolean
}

export default function AddModelDrawer({
  providerId,
  open,
  prefill,
  onClose,
  onSuccess,
  showPurposeSelection
}: AddModelDrawerProps) {
  const { t } = useTranslation()
  const [footerBinding, setFooterBinding] = useState<AddModelDrawerFooterBinding | null>(null)
  const handleSuccess = useCallback(
    (modelIds: UniqueModelId[]) => {
      onSuccess?.(modelIds)
      onClose()
    },
    [onClose, onSuccess]
  )

  const footer =
    footerBinding != null ? (
      <DialogFooter>
        <Button variant="outline" type="button" disabled={footerBinding.isSubmitting} onClick={footerBinding.cancel}>
          {t('common.cancel')}
        </Button>
        <Button type="button" loading={footerBinding.isSubmitting} onClick={() => footerBinding.submit()}>
          {t('settings.models.add.add_model')}
        </Button>
      </DialogFooter>
    ) : null

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        data-testid="provider-settings-model-add-dialog"
        className="max-h-[calc(100vh-6rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-4 sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="text-base leading-5">{t('settings.models.add.add_model')}</DialogTitle>
        </DialogHeader>
        <div className="-m-1 min-h-0 overflow-y-auto p-1">
          <AddModelFormPanel
            providerId={providerId}
            prefill={prefill}
            onSuccess={handleSuccess}
            onCancel={onClose}
            showPurposeSelection={showPurposeSelection}
            onDrawerFooterBinding={setFooterBinding}
          />
        </div>
        {footer}
      </DialogContent>
    </Dialog>
  )
}
