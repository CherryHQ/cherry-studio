import { useUpdateAgent } from '@renderer/hooks/agents/useUpdateAgent'
import { GetAgentSessionResponse } from '@renderer/types'
import { FC } from 'react'

import { AccessibleDirsSetting } from './AccessibleDirsSetting'
import { DescriptionSetting } from './DescriptionSetting'
import { ModelSetting } from './ModelSetting'
import { NameSetting } from './NameSetting'
import { SettingsContainer } from './shared'

// const logger = loggerService.withContext('AgentEssentialSettings')

interface SessionEssentialSettingsProps {
  session: GetAgentSessionResponse | undefined | null
  update: ReturnType<typeof useUpdateAgent>
}

const SessionEssentialSettings: FC<SessionEssentialSettingsProps> = ({ session, update }) => {
  if (!session) return null

  return (
    <SettingsContainer>
      <NameSetting base={session} update={update} />
      <ModelSetting base={session} update={update} isDisabled />
      <AccessibleDirsSetting base={session} update={update} />
      <DescriptionSetting base={session} update={update} />
    </SettingsContainer>
  )
}

export default SessionEssentialSettings
