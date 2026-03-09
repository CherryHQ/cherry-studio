import type { CherryClawConfiguration, UpdateAgentBaseForm } from '@renderer/types'
import { Switch } from 'antd'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { type AgentOrSessionSettingsProps, SettingsContainer, SettingsItem, SettingsTitle } from '../shared'

export const SoulSettings: React.FC<AgentOrSessionSettingsProps> = ({ agentBase, update }) => {
  const { t } = useTranslation()

  const config = useMemo<CherryClawConfiguration>(
    () => (agentBase?.configuration ?? {}) as CherryClawConfiguration,
    [agentBase?.configuration]
  )

  const handleToggle = useCallback(
    (value: boolean) => {
      if (!agentBase) return
      update({
        id: agentBase.id,
        configuration: { ...config, soul_enabled: value }
      } satisfies UpdateAgentBaseForm)
    },
    [agentBase, config, update]
  )

  if (!agentBase) {
    return null
  }

  return (
    <SettingsContainer>
      <SettingsItem inline>
        <SettingsTitle>{t('agent.cherryClaw.soul.enabled')}</SettingsTitle>
        <Switch checked={config.soul_enabled ?? false} onChange={handleToggle} />
      </SettingsItem>
      <SettingsItem divider={false}>
        <SettingsTitle>{t('agent.cherryClaw.soul.preview')}</SettingsTitle>
        <span className="mt-1 text-foreground-500 text-xs">{t('agent.cherryClaw.soul.description')}</span>
      </SettingsItem>
    </SettingsContainer>
  )
}

export default SoulSettings
