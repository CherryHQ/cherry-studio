import { Button } from '@cherrystudio/ui'
import { cn } from '@renderer/utils'
import { Eye, EyeOff, HeartPulse } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'

import { modelListClasses } from '../components/ProviderSettingsPrimitives'

interface ModelListHeaderProps {
  enabledModelCount: number
  modelCount: number
  hasVisibleModels: boolean
  allEnabled: boolean
  isBusy: boolean
  onToggleVisibleModels: (enabled: boolean) => void
  onRunHealthCheck: () => void
  onManageModel: () => void
}

const ModelListHeader: React.FC<ModelListHeaderProps> = ({
  enabledModelCount,
  modelCount,
  hasVisibleModels,
  allEnabled,
  isBusy,
  onToggleVisibleModels,
  onRunHealthCheck,
  onManageModel
}) => {
  const { t } = useTranslation()

  return (
    <div className={modelListClasses.titleRow}>
      <div className="min-w-0">
        <div className={modelListClasses.titleWrap}>
          <h2 className={modelListClasses.sectionTitle}>{t('common.models')}</h2>
          <span className={modelListClasses.countMeta}>
            {enabledModelCount}/{modelCount} {t('common.enabled')}
          </span>
        </div>
      </div>
      <div className={modelListClasses.titleActions}>
        <Button
          variant="ghost"
          size="sm"
          className={cn(modelListClasses.toolbarHeaderGhost, 'gap-1')}
          disabled={!hasVisibleModels || isBusy}
          onClick={() => onToggleVisibleModels(!allEnabled)}>
          {allEnabled ? (
            <EyeOff className={modelListClasses.toolbarHeaderIcon} />
          ) : (
            <Eye className={modelListClasses.toolbarHeaderIcon} />
          )}
          {allEnabled ? t('settings.models.check.disabled') : t('settings.models.check.enabled')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={cn(modelListClasses.toolbarHeaderGhost, 'gap-1')}
          disabled={!hasVisibleModels || isBusy}
          onClick={onRunHealthCheck}>
          <HeartPulse className={modelListClasses.toolbarHeaderIcon} />
          {t('settings.models.check.button_caption')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={cn(modelListClasses.toolbarHeaderGhost, 'gap-1')}
          disabled={isBusy}
          onClick={onManageModel}>
          {t('manage')}
        </Button>
      </div>
    </div>
  )
}

export default ModelListHeader
