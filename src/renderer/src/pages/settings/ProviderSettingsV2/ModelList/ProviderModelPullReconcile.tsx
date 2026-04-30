import { Button } from '@cherrystudio/ui'
import { cn } from '@renderer/utils'
import { Download } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'

import { modelListClasses } from '../components/ProviderSettingsPrimitives'
import ModelListSyncDrawer from './ModelListSyncDrawer'
import { useProviderModelPullReconcile } from './useProviderModelPullReconcile'

interface ProviderModelPullReconcileProps {
  providerId: string
  disabled: boolean
}

const ProviderModelPullReconcile: React.FC<ProviderModelPullReconcileProps> = ({ providerId, disabled }) => {
  const { t } = useTranslation()
  const pullReconcile = useProviderModelPullReconcile(providerId)

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn(modelListClasses.fetchOutline, 'gap-1 px-2 py-[3px] text-xs')}
        disabled={disabled || pullReconcile.isBusy}
        onClick={pullReconcile.openPullReconcile}>
        <Download className={modelListClasses.toolbarDesignIcon} />
        <span>{t('settings.models.toolbar.pull_short')}</span>
      </Button>
      <ModelListSyncDrawer
        open={pullReconcile.pullReconcileDrawerOpen}
        preview={pullReconcile.preview}
        isApplying={pullReconcile.isApplyingPullReconcile}
        onApply={pullReconcile.applyPullReconcile}
        onClose={pullReconcile.closePullReconcile}
      />
    </>
  )
}

export default ProviderModelPullReconcile
