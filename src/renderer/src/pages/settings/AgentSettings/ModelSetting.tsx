import SelectAgentModelButton from '@renderer/pages/home/components/SelectAgentModelButton'
import { AgentBaseWithId, ApiModel, UpdateAgentBaseForm } from '@renderer/types'
import { useTranslation } from 'react-i18next'

import { SettingsItem, SettingsTitle } from './shared'

export interface ModelSettingProps {
  base: AgentBaseWithId | undefined | null
  update: (form: UpdateAgentBaseForm) => Promise<void>
  isDisabled?: boolean
}

export const ModelSetting: React.FC<ModelSettingProps> = ({ base, update, isDisabled }) => {
  const { t } = useTranslation()

  const updateModel = async (model: ApiModel) => {
    if (!base) return
    return update({ id: base.id, model: model.id })
  }

  if (!base) return null

  return (
    <SettingsItem inline className="gap-8">
      <SettingsTitle id="model">{t('common.model')}</SettingsTitle>
      <SelectAgentModelButton agent={base} onSelect={updateModel} isDisabled={isDisabled} />
    </SettingsItem>
  )
}
