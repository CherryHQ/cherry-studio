import { ApiModelLabel } from '@renderer/components/ApiModelLabel'
import { useApiModels } from '@renderer/hooks/agents/useModels'
import { useUpdateAgent } from '@renderer/hooks/agents/useUpdateAgent'
import { AgentEntity, UpdateAgentForm } from '@renderer/types'
import { Input, Select } from 'antd'
import { DefaultOptionType } from 'antd/es/select'
import { FC, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AgentLabel, SettingsContainer, SettingsItem, SettingsTitle } from './shared'

interface AgentEssentialSettingsProps {
  agent: AgentEntity | undefined | null
  update: ReturnType<typeof useUpdateAgent>
}

const AgentEssentialSettings: FC<AgentEssentialSettingsProps> = ({ agent, update }) => {
  const { t } = useTranslation()
  const [name, setName] = useState<string>((agent?.name ?? '').trim())
  const { models } = useApiModels({ providerType: 'anthropic' })
  const agentModel = models.find((model) => model.id === agent?.model)
  const [model, setModel] = useState<string | undefined>(agentModel?.id)

  const onUpdate = () => {
    if (!agent) return
    const _agent = { ...agent, type: undefined, name: name.trim(), model } satisfies UpdateAgentForm
    update(_agent)
  }

  const modelOptions = useMemo(() => {
    return models.map((model) => ({
      value: model.id,
      label: <ApiModelLabel model={model} />
    })) satisfies DefaultOptionType[]
  }, [models])

  if (!agent) return null

  return (
    <SettingsContainer>
      <SettingsItem inline>
        <SettingsTitle>{t('agent.type.label')}</SettingsTitle>
        <AgentLabel type={agent.type} />
      </SettingsItem>
      <SettingsItem inline>
        <SettingsTitle>{t('common.name')}</SettingsTitle>
        <Input
          placeholder={t('common.agent_one') + t('common.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name !== agent.name) {
              onUpdate()
            }
          }}
          className="max-w-80 flex-1"
        />
      </SettingsItem>
      <SettingsItem inline className="gap-8">
        <SettingsTitle>{t('common.model')}</SettingsTitle>
        <Select
          options={modelOptions}
          value={model}
          onChange={(value) => {
            setModel(value)
            onUpdate()
          }}
          className="max-w-80 flex-1"
          placeholder={t('common.placeholders.select.model')}
        />
      </SettingsItem>
    </SettingsContainer>
  )
}

export default AgentEssentialSettings
