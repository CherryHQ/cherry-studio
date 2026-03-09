import type { CherryClawConfiguration, SchedulerType, UpdateAgentBaseForm } from '@renderer/types'
import { Input, InputNumber, Select, Switch } from 'antd'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { type AgentOrSessionSettingsProps, SettingsContainer, SettingsItem, SettingsTitle } from '../shared'

const schedulerTypeOptions: { value: SchedulerType; labelKey: string }[] = [
  { value: 'cron', labelKey: 'agent.cherryClaw.scheduler.type.cron' },
  { value: 'interval', labelKey: 'agent.cherryClaw.scheduler.type.interval' },
  { value: 'one-time', labelKey: 'agent.cherryClaw.scheduler.type.one-time' }
]

export const SchedulerSettings: React.FC<AgentOrSessionSettingsProps> = ({ agentBase, update }) => {
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

  const handleEnabledToggle = useCallback(
    (value: boolean) => updateConfig({ scheduler_enabled: value }),
    [updateConfig]
  )

  const handleTypeChange = useCallback(
    (value: SchedulerType) => updateConfig({ scheduler_type: value }),
    [updateConfig]
  )

  const handleCronChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => updateConfig({ scheduler_cron: e.target.value }),
    [updateConfig]
  )

  const handleIntervalChange = useCallback(
    (value: number | null) => updateConfig({ scheduler_interval: value ?? undefined }),
    [updateConfig]
  )

  const handleDelayChange = useCallback(
    (value: number | null) => updateConfig({ scheduler_one_time_delay: value ?? undefined }),
    [updateConfig]
  )

  if (!agentBase) {
    return null
  }

  const schedulerType = config.scheduler_type ?? 'interval'

  return (
    <SettingsContainer>
      <SettingsItem inline>
        <SettingsTitle>{t('agent.cherryClaw.scheduler.enabled')}</SettingsTitle>
        <Switch checked={config.scheduler_enabled ?? false} onChange={handleEnabledToggle} />
      </SettingsItem>

      <SettingsItem>
        <SettingsTitle>{t('agent.cherryClaw.scheduler.type.label')}</SettingsTitle>
        <Select value={schedulerType} onChange={handleTypeChange} style={{ width: '100%' }} className="mt-1">
          {schedulerTypeOptions.map((opt) => (
            <Select.Option key={opt.value} value={opt.value}>
              {t(opt.labelKey)}
            </Select.Option>
          ))}
        </Select>
      </SettingsItem>

      {schedulerType === 'cron' && (
        <SettingsItem>
          <SettingsTitle>{t('agent.cherryClaw.scheduler.cron.label')}</SettingsTitle>
          <Input
            value={config.scheduler_cron ?? ''}
            onChange={handleCronChange}
            placeholder="0 * * * *"
            className="mt-1"
          />
        </SettingsItem>
      )}

      {schedulerType === 'interval' && (
        <SettingsItem>
          <SettingsTitle>{t('agent.cherryClaw.scheduler.interval.label')}</SettingsTitle>
          <InputNumber
            min={1}
            value={config.scheduler_interval ?? 60}
            onChange={handleIntervalChange}
            style={{ width: '100%' }}
            className="mt-1"
          />
        </SettingsItem>
      )}

      {schedulerType === 'one-time' && (
        <SettingsItem>
          <SettingsTitle>{t('agent.cherryClaw.scheduler.oneTime.label')}</SettingsTitle>
          <InputNumber
            min={0}
            value={config.scheduler_one_time_delay ?? 0}
            onChange={handleDelayChange}
            style={{ width: '100%' }}
            className="mt-1"
          />
        </SettingsItem>
      )}

      {config.scheduler_last_run && (
        <SettingsItem divider={false}>
          <SettingsTitle>{t('agent.cherryClaw.scheduler.lastRun')}</SettingsTitle>
          <span className="mt-1 text-foreground-500 text-xs">{config.scheduler_last_run}</span>
        </SettingsItem>
      )}
    </SettingsContainer>
  )
}

export default SchedulerSettings
