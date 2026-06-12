import { Button } from '@cherrystudio/ui'
import { Plus } from 'lucide-react'
import type React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { modelListClasses } from '../primitives/ProviderSettingsPrimitives'
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
        size="icon-sm"
        className={modelListClasses.addModelIconButton}
        disabled={disabled}
        aria-label={t('settings.models.add.add_model')}
        onClick={openDrawer}>
        <Plus className={modelListClasses.toolbarDesignIcon} />
      </Button>
      <AddModelDrawer providerId={providerId} open={drawerOpen} prefill={null} onClose={closeDrawer} />
    </>
  )
}

export default ProviderModelAdd
