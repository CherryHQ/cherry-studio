import { ModelSettingsNavigation } from '@renderer/components/ModelSettingsNavigation'
import {
  SettingDescription,
  SettingDivider,
  SettingRow,
  SettingRowTitle
} from '@renderer/components/SettingsPrimitives'
import { useDefaultModel } from '@renderer/hooks/useModel'
import type { Model } from '@shared/data/types/model'
import { useNavigate } from '@tanstack/react-router'
import type { FC } from 'react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

interface ModelNavigationRowProps {
  description: string
  model: Model | undefined
  onNavigate: () => void
  title: string
}

const ModelNavigationRow: FC<ModelNavigationRowProps> = ({ description, model, onNavigate, title }) => {
  const titleId = useId()

  return (
    <SettingRow role="group" aria-labelledby={titleId} className="gap-4 py-1.5">
      <div className="min-w-0 flex-1">
        <SettingRowTitle id={titleId}>{title}</SettingRowTitle>
        <SettingDescription className="mt-1.5 leading-5">{description}</SettingDescription>
      </div>
      <ModelSettingsNavigation model={model} onNavigate={onNavigate} />
    </SettingRow>
  )
}

const SelectionActionModelSettings: FC = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { defaultModel, translateModel } = useDefaultModel()

  return (
    <>
      <ModelNavigationRow
        title={t('settings.models.default_assistant_model')}
        description={t('selection.settings.actions.models.default_description')}
        model={defaultModel}
        onNavigate={() => void navigate({ to: '/settings/model', search: { focus: 'default' } })}
      />
      <SettingDivider />
      <ModelNavigationRow
        title={t('settings.models.translate_model')}
        description={t('selection.settings.actions.models.translate_description')}
        model={translateModel}
        onNavigate={() => void navigate({ to: '/settings/model', search: { focus: 'translate' } })}
      />
      <SettingDivider />
    </>
  )
}

export default SelectionActionModelSettings
