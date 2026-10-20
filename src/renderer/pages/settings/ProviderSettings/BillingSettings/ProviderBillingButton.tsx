import { Calculator } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Tooltip } from '@cherrystudio/ui'
import { useProvider } from '@renderer/hooks/useProvider'

import { modelListClasses } from '../primitives/ProviderSettingsPrimitives'

const ProviderBillingDrawer = lazy(() => import('./ProviderBillingDrawer'))

export function ProviderBillingButton({ providerId, disabled }: { providerId: string; disabled: boolean }) {
  const { t } = useTranslation()
  const { provider } = useProvider(providerId)
  const [open, setOpen] = useState(false)
  return (
    <>
      <Tooltip content={t('settings.provider.billing.title')}>
        <Button
          variant="ghost"
          size="icon-sm"
          className={modelListClasses.searchIconButton}
          aria-label={t('settings.provider.billing.title')}
          disabled={disabled}
          onClick={() => setOpen(true)}>
          <Calculator className={modelListClasses.toolbarHeaderIcon} aria-hidden />
        </Button>
      </Tooltip>
      {open && provider && (
        <Suspense fallback={null}>
          <ProviderBillingDrawer provider={provider} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  )
}
