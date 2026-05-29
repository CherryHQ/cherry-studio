import type { FC } from 'react'

import { type AgentOrSessionSettingsProps, SettingsContainer } from '../shared'
import { AccessibleDirsSetting } from './AccessibleDirsSetting'
import { DescriptionSetting } from './DescriptionSetting'
import { HeartbeatSetting } from './HeartbeatSetting'
import { ModelSetting } from './ModelSetting'
import { NameSetting } from './NameSetting'
import { SoulModeSetting } from './SoulModeSetting'

type EssentialSettingsProps = AgentOrSessionSettingsProps & {
  showModelSetting?: boolean
}

const EssentialSettings: FC<EssentialSettingsProps> = ({ agentBase, update, showModelSetting = true }) => {
  if (!agentBase) return null

  return (
    <SettingsContainer>
      <NameSetting base={agentBase} update={update} />
      {showModelSetting && <ModelSetting base={agentBase} update={update} />}
      <AccessibleDirsSetting base={agentBase} update={update} />
      <SoulModeSetting base={agentBase} update={update} />
      <HeartbeatSetting base={agentBase} update={update} />
      <DescriptionSetting base={agentBase} update={update} />
    </SettingsContainer>
  )
}

export default EssentialSettings
