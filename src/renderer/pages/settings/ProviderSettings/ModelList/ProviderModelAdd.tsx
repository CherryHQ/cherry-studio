import { Plus } from 'lucide-react'
import type React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, NormalTooltip } from '@cherrystudio/ui'
import type { UniqueModelId } from '@shared/data/types/model'

import { modelListClasses } from '../primitives/ProviderSettingsPrimitives'
import { AddModelDrawer } from './ModelDrawer'

interface ProviderModelAddProps {
  providerId: string
  disabled: boolean
}

interface ProviderModelAddDialogProps {
  providerId: string
  open: boolean
  onClose: () => void
  onSuccess?: (modelIds: UniqueModelId[]) => void
  showPurposeSelection?: boolean
}

export function ProviderModelAddDialog({
  providerId,
  open,
  onClose,
  onSuccess,
  showPurposeSelection
}: ProviderModelAddDialogProps) {
  return (
    <AddModelDrawer
      providerId={providerId}
      open={open}
      prefill={null}
      onClose={onClose}
      onSuccess={onSuccess}
      showPurposeSelection={showPurposeSelection}
    />
  )
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
  const label = t('settings.provider.api_setup.add_model_manually')

  return (
    <>
      <NormalTooltip content={label}>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className={modelListClasses.addModelIconButton}
          disabled={disabled}
          aria-label={label}
          onClick={openDrawer}>
          <Plus className={modelListClasses.toolbarDesignIcon} />
        </Button>
      </NormalTooltip>
      <ProviderModelAddDialog providerId={providerId} open={drawerOpen} onClose={closeDrawer} />
    </>
  )
}

export default ProviderModelAdd
