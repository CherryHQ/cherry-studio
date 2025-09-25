import { Select, SelectedItems, SelectItem } from '@heroui/react'
import { ApiModelLabel } from '@renderer/components/ApiModelLabel'
import { useApiModels } from '@renderer/hooks/agents/useModels'
import { AgentBaseWithId, ApiModel, UpdateAgentBaseForm, UpdateAgentForm } from '@renderer/types'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingsItem, SettingsTitle } from './shared'

export interface ModelSettingProps {
  base: AgentBaseWithId | undefined | null
  update: (form: UpdateAgentBaseForm) => Promise<void>
  isDisabled?: boolean
}

export const ModelSetting: React.FC<ModelSettingProps> = ({ base, update, isDisabled }) => {
  const { t } = useTranslation()
  const { models } = useApiModels({ providerType: 'anthropic' })

  const updateModel = (model: UpdateAgentForm['model']) => {
    if (!base) return
    update({ id: base.id, model })
  }

  const renderModels = useCallback((items: SelectedItems<ApiModel>) => {
    return items.map((item) => {
      const model = item.data ?? undefined
      return <ApiModelLabel key={model?.id} model={model} />
    })
  }, [])

  if (!base) return null

  return (
    <SettingsItem inline className="gap-8">
      <SettingsTitle id="model">{t('common.model')}</SettingsTitle>
      <Select
        isDisabled={isDisabled}
        selectionMode="single"
        aria-labelledby="model"
        items={models}
        selectedKeys={[base.model]}
        onSelectionChange={(keys) => {
          updateModel(keys.currentKey)
        }}
        className="max-w-80 flex-1"
        placeholder={t('common.placeholders.select.model')}
        renderValue={renderModels}>
        {(model) => (
          <SelectItem textValue={model.id}>
            <ApiModelLabel model={model} />
          </SelectItem>
        )}
      </Select>
    </SettingsItem>
  )
}
