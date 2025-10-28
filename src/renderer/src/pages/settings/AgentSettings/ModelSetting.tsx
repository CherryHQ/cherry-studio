import SelectAgentBaseModelButton from '@renderer/pages/home/components/SelectAgentBaseModelButton'
import {
  AgentBaseWithId,
  AgentEntity,
  AgentSessionEntity,
  ApiModel,
  UpdateAgentForm,
  UpdateSessionForm
} from '@renderer/types'
import { useTranslation } from 'react-i18next'

import { SettingsItem, SettingsTitle } from './shared'

export interface ModelSettingProps {
  base: AgentBaseWithId | undefined | null
  update:
    | ((form: UpdateAgentForm) => Promise<AgentEntity | undefined>)
    | ((form: UpdateSessionForm) => Promise<AgentSessionEntity | undefined>)
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
    <SettingsItem inline>
      <SettingsTitle id="model">{t('common.model')}</SettingsTitle>
      <SelectAgentBaseModelButton
        agentBase={base}
        onSelect={async (model) => {
          await updateModel(model)
        }}
        isDisabled={isDisabled}
      />
    </SettingsItem>
  )
}
