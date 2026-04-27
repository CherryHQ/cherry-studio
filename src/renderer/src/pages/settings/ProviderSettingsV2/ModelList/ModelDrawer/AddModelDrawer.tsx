import { useTranslation } from 'react-i18next'

import ProviderSettingsDrawer from '../../components/ProviderSettingsDrawer'
import AddModelFormPanel from './AddModelFormPanel'
import type { AddModelDrawerPrefill } from './types'

interface AddModelDrawerProps {
  providerId: string
  open: boolean
  prefill: AddModelDrawerPrefill | null
  onClose: () => void
}

/** Optional wrapper around `AddModelFormPanel` (full form) for tests or non-inline flows. Inline add lives in `ManageModelsDrawer`. */
export default function AddModelDrawer({ providerId, open, prefill, onClose }: AddModelDrawerProps) {
  const { t } = useTranslation()

  if (!open) {
    return null
  }

  return (
    <ProviderSettingsDrawer open={open} onClose={onClose} title={t('settings.models.add.add_model')}>
      <AddModelFormPanel providerId={providerId} prefill={prefill} onSuccess={onClose} onCancel={onClose} />
    </ProviderSettingsDrawer>
  )
}
