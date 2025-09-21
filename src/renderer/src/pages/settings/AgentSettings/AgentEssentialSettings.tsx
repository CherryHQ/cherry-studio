import { HStack } from '@renderer/components/Layout'
import { useUpdateAgent } from '@renderer/hooks/agents/useUpdateAgent'
import { AgentEntity, UpdateAgentForm } from '@renderer/types'
import { Input } from 'antd'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider } from '..'
import { AgentLabel, SettingsInline, SettingsTitle } from './shared'

interface AgentEssentialSettingsProps {
  agent: AgentEntity | undefined | null
  update: ReturnType<typeof useUpdateAgent>
}

const AgentEssentialSettings: FC<AgentEssentialSettingsProps> = ({ agent, update }) => {
  const { t } = useTranslation()
  const [name, setName] = useState<string>((agent?.name ?? '').trim())

  const onUpdate = () => {
    if (!agent) return
    const _agent = { ...agent, type: undefined, name: name.trim() } satisfies UpdateAgentForm
    update(_agent)
  }

  if (!agent) return null

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <SettingsInline>
        <SettingsTitle>{t('agent.type.label')}</SettingsTitle>
        <AgentLabel type={agent.type} />
      </SettingsInline>
      <SettingDivider />
      <SettingsTitle>{t('common.name')}</SettingsTitle>
      <HStack gap={8} alignItems="center">
        <Input
          placeholder={t('common.assistant') + t('common.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name !== agent.name) {
              onUpdate()
            }
          }}
          style={{ flex: 1 }}
        />
      </HStack>
    </div>
  )
}

export default AgentEssentialSettings
