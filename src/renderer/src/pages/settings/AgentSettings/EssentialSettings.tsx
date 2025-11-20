import type { useUpdateAgent } from '@renderer/hooks/agents/useUpdateAgent'
import type { useUpdateSession } from '@renderer/hooks/agents/useUpdateSession'
import type { GetAgentResponse, GetAgentSessionResponse } from '@renderer/types'
import type { FC } from 'react'

import { AccessibleDirsSetting } from './AccessibleDirsSetting'
import { DescriptionSetting } from './DescriptionSetting'
import { ModelSetting } from './ModelSetting'
import { NameSetting } from './NameSetting'
import { SettingsContainer } from './shared'

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
  if (!agentBase) return null

  return (
    <SettingsContainer>
      <NameSetting base={agentBase} update={update} />
      {showModelSetting && <ModelSetting base={agentBase} update={update} />}
      <AccessibleDirsSetting base={agentBase} update={update} />
      <DescriptionSetting base={agentBase} update={update} />
    </SettingsContainer>
  )
}

export default EssentialSettings
