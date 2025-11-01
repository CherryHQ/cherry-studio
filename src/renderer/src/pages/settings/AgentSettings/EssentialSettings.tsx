import { Avatar } from '@heroui/react'
import { getAgentTypeAvatar } from '@renderer/config/agent'
import type { useUpdateAgent } from '@renderer/hooks/agents/useUpdateAgent'
import type { useUpdateSession } from '@renderer/hooks/agents/useUpdateSession'
import { getAgentTypeLabel } from '@renderer/i18n/label'
import type { GetAgentResponse, GetAgentSessionResponse } from '@renderer/types'
import { isAgentEntity } from '@renderer/types'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { AccessibleDirsSetting } from './AccessibleDirsSetting'
import { AvatarSetting } from './AvatarSetting'
import { DescriptionSetting } from './DescriptionSetting'
import { ModelSetting } from './ModelSetting'
import { NameSetting } from './NameSetting'
import { SettingsContainer, SettingsItem, SettingsTitle } from './shared'

// const logger = loggerService.withContext('AgentEssentialSettings')

type EssentialSettingsProps =
  | {
      agentBase: GetAgentResponse | undefined | null
      update: ReturnType<typeof useUpdateAgent>['updateAgent']
      showModelSetting?: boolean
    }
  | {
      agentBase: GetAgentSessionResponse | undefined | null
      update: ReturnType<typeof useUpdateSession>['updateSession']
      showModelSetting?: boolean
    }

const EssentialSettings: FC<EssentialSettingsProps> = ({ agentBase, update, showModelSetting = true }) => {
  const { t } = useTranslation()

  if (!agentBase) return null

  const isAgent = isAgentEntity(agentBase)

  return (
    <SettingsContainer>
      {isAgent && (
        <SettingsItem inline>
          <SettingsTitle>{t('agent.type.label')}</SettingsTitle>
          <div className="flex items-center gap-2">
            <Avatar src={getAgentTypeAvatar(agentBase.type)} className="h-6 w-6 text-lg" />
            <span>{(agentBase?.name ?? agentBase?.type) ? getAgentTypeLabel(agentBase.type) : ''}</span>
          </div>
        </SettingsItem>
      )}
      {isAgent && (
        <AvatarSetting agent={agentBase} update={update as ReturnType<typeof useUpdateAgent>['updateAgent']} />
      )}
      <NameSetting base={agentBase} update={update} />
      {showModelSetting && <ModelSetting base={agentBase} update={update} />}
      <AccessibleDirsSetting base={agentBase} update={update} />
      <DescriptionSetting base={agentBase} update={update} />
    </SettingsContainer>
  )
}

export default EssentialSettings
