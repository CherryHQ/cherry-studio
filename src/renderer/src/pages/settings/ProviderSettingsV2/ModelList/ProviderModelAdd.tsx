import { Button } from '@cherrystudio/ui'
import { cn } from '@renderer/utils'
import { Plus } from 'lucide-react'
import type React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { modelListClasses } from '../components/ProviderSettingsPrimitives'
import { AddModelDrawer } from './ModelDrawer'

interface ProviderModelAddProps {
  providerId: string
  disabled: boolean
}

const ProviderModelAdd: React.FC<ProviderModelAddProps> = ({ providerId, disabled }) => {
  const { t } = useTranslation()
  const [drawerOpen, setDrawerOpen] = useState(false)

  const openDrawer = useCallback(() => {
    setDrawerOpen(true)
  }, [])

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false)
  }, [])

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn(modelListClasses.fetchOutline, 'gap-1 px-2 py-[3px] text-xs')}
        disabled={disabled}
        aria-label={t('settings.models.add.add_model')}
        onClick={openDrawer}>
        <Plus className={modelListClasses.toolbarDesignIcon} />
        <span>{t('common.add')}</span>
      </Button>
      <AddModelDrawer providerId={providerId} open={drawerOpen} prefill={null} onClose={closeDrawer} />
    </>
  )
}

export default ProviderModelAdd
