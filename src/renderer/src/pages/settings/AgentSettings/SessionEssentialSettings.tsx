import type { useUpdateAgent } from '@renderer/hooks/agents/useUpdateAgent'
import type { GetAgentSessionResponse } from '@renderer/types'
import type { FC } from 'react'

import { AccessibleDirsSetting } from './AccessibleDirsSetting'
import { DescriptionSetting } from './DescriptionSetting'
import { NameSetting } from './NameSetting'
import { SettingsContainer } from './shared'

// const logger = loggerService.withContext('AgentEssentialSettings')

interface SessionEssentialSettingsProps {
  session: GetAgentSessionResponse | undefined | null
  update: ReturnType<typeof useUpdateAgent>['updateAgent']
}

const SessionEssentialSettings: FC<SessionEssentialSettingsProps> = ({ session, update }) => {
  if (!session) return null

  return (
    <SettingsContainer>
      <NameSetting base={session} update={update} />
      <AccessibleDirsSetting base={session} update={update} />
      <DescriptionSetting base={session} update={update} />
    </SettingsContainer>
  )
}

export default SessionEssentialSettings
