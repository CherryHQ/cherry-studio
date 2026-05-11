import { Button } from '@cherrystudio/ui'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import ProviderActions from '../../primitives/ProviderActions'
import ProviderSettingsDrawer from '../../primitives/ProviderSettingsDrawer'
import { drawerClasses } from '../../primitives/ProviderSettingsPrimitives'
import AddModelFormPanel, { type AddModelDrawerFooterBinding } from './AddModelFormPanel'
import type { AddModelDrawerPrefill } from './types'

interface AddModelDrawerProps {
  providerId: string
  open: boolean
  prefill: AddModelDrawerPrefill | null
  onClose: () => void
}

/**
 * The wrapper stays mounted so `PageSidePanel`'s `AnimatePresence` can play its exit animation when `open` flips to `false`.
 */
export default function AddModelDrawer({ providerId, open, prefill, onClose }: AddModelDrawerProps) {
  const { t } = useTranslation()
  const [footerBinding, setFooterBinding] = useState<AddModelDrawerFooterBinding | null>(null)

  const footer =
    footerBinding != null ? (
      <ProviderActions className={drawerClasses.footer}>
        <Button variant="outline" type="button" disabled={footerBinding.isSubmitting} onClick={footerBinding.cancel}>
          {t('common.cancel')}
        </Button>
        <Button type="button" loading={footerBinding.isSubmitting} onClick={() => footerBinding.submit()}>
          {t('settings.models.add.add_model')}
        </Button>
      </ProviderActions>
    ) : null

  return (
    <ProviderSettingsDrawer open={open} onClose={onClose} title={t('settings.models.add.add_model')} footer={footer}>
      <AddModelFormPanel
        providerId={providerId}
        prefill={prefill}
        onSuccess={onClose}
        onCancel={onClose}
        onDrawerFooterBinding={setFooterBinding}
      />
    </ProviderSettingsDrawer>
  )
}
