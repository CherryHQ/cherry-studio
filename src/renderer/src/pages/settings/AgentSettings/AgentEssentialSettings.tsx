import { useUpdateAgent } from '@renderer/hooks/agents/useUpdateAgent'
import { GetAgentResponse } from '@renderer/types'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { AccessibleDirsSetting } from './AccessibleDirsSetting'
import { DescriptionSetting } from './DescriptionSetting'
import { ModelSetting } from './ModelSetting'
import { NameSetting } from './NameSetting'
import { AgentLabel, SettingsContainer, SettingsItem, SettingsTitle } from './shared'

// const logger = loggerService.withContext('AgentEssentialSettings')

interface AgentEssentialSettingsProps {
  agent: GetAgentResponse | undefined | null
  update: ReturnType<typeof useUpdateAgent>
}

const AgentEssentialSettings: FC<AgentEssentialSettingsProps> = ({ agent, update }) => {
  const { t } = useTranslation()

  if (!agent) return null

  return (
    <SettingsContainer>
      <SettingsItem inline>
        <SettingsTitle>{t('agent.type.label')}</SettingsTitle>
        <AgentLabel type={agent.type} />
      </SettingsItem>
      <NameSetting base={agent} update={update} />
      <ModelSetting base={agent} update={update} />
      <AccessibleDirsSetting base={agent} update={update} />
      <DescriptionSetting base={agent} update={update} />
    </SettingsContainer>
  )
}

export default AgentEssentialSettings
