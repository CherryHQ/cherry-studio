import type {
  AgentBaseWithId,
  AgentConfiguration,
  UpdateAgentBaseForm,
  UpdateAgentFunctionUnion
} from '@renderer/types'
import { InputNumber, Switch, Tooltip } from 'antd'
import { Info } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingsItem, SettingsTitle } from '../shared'

interface HeartbeatSettingProps {
  base: AgentBaseWithId | undefined | null
  update: UpdateAgentFunctionUnion
}

export const HeartbeatSetting = ({ base: agentBase, update }: HeartbeatSettingProps) => {
  const { t } = useTranslation()

  const config = useMemo(() => (agentBase?.configuration ?? {}) as AgentConfiguration, [agentBase?.configuration])
  const enabled = config.heartbeat_enabled ?? true
  const interval = config.heartbeat_interval ?? 30

  const updateConfig = useCallback(
    (patch: Partial<AgentConfiguration>) => {
      if (!agentBase) return
      void update({
        id: agentBase.id,
        configuration: { ...config, ...patch }
      } satisfies UpdateAgentBaseForm)
    },
    [agentBase, config, update]
  )

  if (!agentBase) return null

  return (
    <>
      <SettingsItem inline>
        <SettingsTitle
          contentAfter={
            <Tooltip title={t('agent.cherryClaw.heartbeat.enabledHelper')} placement="right">
              <Info size={16} className="text-foreground-400" />
            </Tooltip>
          }>
          {t('agent.cherryClaw.heartbeat.enabled')}
        </SettingsTitle>
        <Switch checked={enabled} size="small" onChange={(checked) => updateConfig({ heartbeat_enabled: checked })} />
      </SettingsItem>
      {enabled && (
        <SettingsItem inline>
          <SettingsTitle
            contentAfter={
              <Tooltip title={t('agent.cherryClaw.heartbeat.intervalHelper')} placement="right">
                <Info size={16} className="text-foreground-400" />
              </Tooltip>
            }>
            {t('agent.cherryClaw.heartbeat.interval')}
          </SettingsTitle>
          <InputNumber
            size="small"
            min={1}
            max={1440}
            value={interval}
            onChange={(val) => val && updateConfig({ heartbeat_interval: val })}
            style={{ width: 100 }}
            suffix="min"
          />
        </SettingsItem>
      )}
    </>
  )
}
