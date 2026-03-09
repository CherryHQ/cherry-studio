import { useTranslation } from 'react-i18next'

import { type AgentOrSessionSettingsProps, SettingsContainer, SettingsItem, SettingsTitle } from '../shared'

export const ChannelsSettings: React.FC<AgentOrSessionSettingsProps> = ({ agentBase }) => {
  const { t } = useTranslation()

  if (!agentBase) {
    return null
  }

  return (
    <SettingsContainer>
      <SettingsItem divider={false}>
        <SettingsTitle>{t('agent.cherryClaw.channels.title')}</SettingsTitle>
        <span className="mt-1 text-foreground-500 text-xs">{t('agent.cherryClaw.channels.comingSoon')}</span>
      </SettingsItem>
    </SettingsContainer>
  )
}

export default ChannelsSettings
