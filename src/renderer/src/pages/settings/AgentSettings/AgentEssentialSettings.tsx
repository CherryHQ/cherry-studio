import { useModels } from '@renderer/hooks/agents/useModels'
import { useUpdateAgent } from '@renderer/hooks/agents/useUpdateAgent'
import { AgentEntity, UpdateAgentForm } from '@renderer/types'
import { Input, Select } from 'antd'
import { DefaultOptionType } from 'antd/es/select'
import { FC, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AgentLabel, ModelLabel, SettingsContainer, SettingsItem, SettingsTitle } from './shared'

interface AgentEssentialSettingsProps {
  agent: AgentEntity | undefined | null
  update: ReturnType<typeof useUpdateAgent>
}

const AgentEssentialSettings: FC<AgentEssentialSettingsProps> = ({ agent, update }) => {
  const { t } = useTranslation()
  const [name, setName] = useState<string>((agent?.name ?? '').trim())
  const { models } = useModels({ providerType: 'anthropic' })

  const onUpdate = () => {
    if (!agent) return
    const _agent = { ...agent, type: undefined, name: name.trim() } satisfies UpdateAgentForm
    update(_agent)
  }

  const modelOptions = useMemo(() => {
    return models.map((model) => ({
      value: model.id,
      label: <ModelLabel model={model} />
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
          className="max-w-80 flex-1"
          placeholder={t('common.placeholders.select.model')}
        />
      </SettingsItem>
    </SettingsContainer>
  )
}

export default AgentEssentialSettings
