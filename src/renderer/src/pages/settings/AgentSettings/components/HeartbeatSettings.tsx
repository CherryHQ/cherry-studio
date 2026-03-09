import type { CherryClawConfiguration, UpdateAgentBaseForm } from '@renderer/types'
import { Input, Switch } from 'antd'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { type AgentOrSessionSettingsProps, SettingsContainer, SettingsItem, SettingsTitle } from '../shared'

export const HeartbeatSettings: React.FC<AgentOrSessionSettingsProps> = ({ agentBase, update }) => {
  const { t } = useTranslation()

  const config = useMemo<CherryClawConfiguration>(
    () => (agentBase?.configuration ?? {}) as CherryClawConfiguration,
    [agentBase?.configuration]
  )

  const updateConfig = useCallback(
    (patch: Partial<CherryClawConfiguration>) => {
      if (!agentBase) return
      update({
        id: agentBase.id,
        configuration: { ...config, ...patch }
      } satisfies UpdateAgentBaseForm)
    },
    [agentBase, config, update]
  )

  const handleToggle = useCallback((value: boolean) => updateConfig({ heartbeat_enabled: value }), [updateConfig])

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => updateConfig({ heartbeat_file: e.target.value }),
    [updateConfig]
  )

  if (!agentBase) {
    return null
  }

  return (
    <SettingsContainer>
      <SettingsItem inline>
        <SettingsTitle>{t('agent.cherryClaw.heartbeat.enabled')}</SettingsTitle>
        <Switch checked={config.heartbeat_enabled ?? false} onChange={handleToggle} />
      </SettingsItem>
      <SettingsItem divider={false}>
        <SettingsTitle>{t('agent.cherryClaw.heartbeat.file')}</SettingsTitle>
        <Input
          value={config.heartbeat_file ?? 'heartbeat.md'}
          onChange={handleFileChange}
          placeholder="heartbeat.md"
          className="mt-1"
        />
        <span className="mt-1 text-foreground-500 text-xs">{t('agent.cherryClaw.heartbeat.description')}</span>
      </SettingsItem>
    </SettingsContainer>
  )
}

export default HeartbeatSettings
