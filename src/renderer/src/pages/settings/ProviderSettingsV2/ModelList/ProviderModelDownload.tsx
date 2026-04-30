import { Button } from '@cherrystudio/ui'
import { cn } from '@renderer/utils'
import { Plus } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'

import { modelListClasses } from '../components/ProviderSettingsPrimitives'
import { useOvmsModelDownloadAction } from './useOvmsModelDownloadAction'

interface ProviderModelDownloadProps {
  providerId: string
  disabled: boolean
}

const ProviderModelDownload: React.FC<ProviderModelDownloadProps> = ({ providerId, disabled }) => {
  const { t } = useTranslation()
  const { openOvmsModelDownload } = useOvmsModelDownloadAction(providerId)

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn(modelListClasses.fetchOutline, 'gap-1 px-2 py-[3px] text-xs')}
      disabled={disabled}
      aria-label={t('button.download')}
      onClick={openOvmsModelDownload}>
      <Plus className={modelListClasses.toolbarDesignIcon} />
      <span>{t('button.download')}</span>
    </Button>
  )
}

export default ProviderModelDownload
