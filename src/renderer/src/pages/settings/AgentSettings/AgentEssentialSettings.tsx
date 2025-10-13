import { Avatar } from '@heroui/react'
import { getAgentTypeAvatar } from '@renderer/config/agent'
import type { useUpdateAgent } from '@renderer/hooks/agents/useUpdateAgent'
import { getAgentTypeLabel } from '@renderer/i18n/label'
import type { GetAgentResponse } from '@renderer/types'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { AccessibleDirsSetting } from './AccessibleDirsSetting'
import { AvatarSetting } from './AvatarSetting'
import { DescriptionSetting } from './DescriptionSetting'
import { ModelSetting } from './ModelSetting'
import { NameSetting } from './NameSetting'
import { SettingsContainer, SettingsItem, SettingsTitle } from './shared'

// const logger = loggerService.withContext('AgentEssentialSettings')

interface AgentEssentialSettingsProps {
  agent: GetAgentResponse | undefined | null
  update: ReturnType<typeof useUpdateAgent>['updateAgent']
}

const AgentEssentialSettings: FC<AgentEssentialSettingsProps> = ({ agent, update }) => {
  const { t } = useTranslation()

  if (!agent) return null

  return (
    <SettingsContainer>
      <SettingsItem inline>
        <SettingsTitle>{t('agent.type.label')}</SettingsTitle>
        <div className="flex items-center gap-2">
          <Avatar src={getAgentTypeAvatar(agent.type)} className="h-6 w-6 text-lg" />
          <span>{(agent?.name ?? agent?.type) ? getAgentTypeLabel(agent.type) : ''}</span>
        </div>
      </SettingsItem>
      <AvatarSetting agent={agent} update={update} />
      <NameSetting base={agent} update={update} />
      <ModelSetting base={agent} update={update} />
      <AccessibleDirsSetting base={agent} update={update} />
      <DescriptionSetting base={agent} update={update} />
    </SettingsContainer>
  )
}

export default AgentEssentialSettings
