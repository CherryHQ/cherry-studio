import { ArrowRight } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, RowFlex } from '@cherrystudio/ui'
import type { Model } from '@shared/data/types/model'

import ModelAvatar from './Avatar/ModelAvatar'

interface ModelSettingsNavigationProps {
  model: Model | undefined
  onNavigate: () => void
}

export const ModelSettingsNavigation: FC<ModelSettingsNavigationProps> = ({ model, onNavigate }) => {
  const { t } = useTranslation()

  return (
    <RowFlex className="min-w-0 items-center gap-3">
      <RowFlex className="min-w-0 max-w-44 items-center gap-2">
        {model ? <ModelAvatar model={model} size={18} className="shrink-0" /> : null}
        <span className="truncate text-foreground text-sm">{model?.name ?? t('settings.models.empty')}</span>
      </RowFlex>
      <Button variant="outline" size="sm" className="shrink-0" onClick={onNavigate}>
        <ArrowRight size={13} />
        {t('navigate.model_settings')}
      </Button>
    </RowFlex>
  )
}
