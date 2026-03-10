import type { CherryClawConfiguration, UpdateAgentBaseForm } from '@renderer/types'
import { AgentConfigurationSchema } from '@renderer/types'
import { InputNumber, Switch, Tooltip } from 'antd'
import { Info } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  type AgentConfigurationState,
  type AgentOrSessionSettingsProps,
  defaultConfiguration,
  SettingsContainer,
  SettingsItem,
  SettingsTitle
} from '../shared'

export const AdvancedSettings: React.FC<AgentOrSessionSettingsProps> = ({ agentBase, update }) => {
  const { t } = useTranslation()
  const [configuration, setConfiguration] = useState<AgentConfigurationState>(defaultConfiguration)
  const [maxTurnsInput, setMaxTurnsInput] = useState<number>(defaultConfiguration.max_turns)

  const isCherryClaw = agentBase && 'type' in agentBase && agentBase.type === 'cherry-claw'

  useEffect(() => {
    if (!agentBase) {
      setConfiguration(defaultConfiguration)
      setMaxTurnsInput(defaultConfiguration.max_turns)
      return
    }
    const parsed: AgentConfigurationState = AgentConfigurationSchema.parse(agentBase.configuration ?? {})
    setConfiguration(parsed)
    setMaxTurnsInput(parsed.max_turns)
  }, [agentBase])

  const commitMaxTurns = useCallback(() => {
    if (!agentBase) return
    if (!Number.isFinite(maxTurnsInput)) {
      setMaxTurnsInput(configuration.max_turns)
      return
    }
    const sanitized = Math.max(1, maxTurnsInput)
    if (sanitized === configuration.max_turns) {
      setMaxTurnsInput(configuration.max_turns)
      return
    }
    const next: AgentConfigurationState = { ...configuration, max_turns: sanitized }
    setConfiguration(next)
    setMaxTurnsInput(sanitized)
    update({ id: agentBase.id, configuration: next } satisfies UpdateAgentBaseForm)
  }, [agentBase, configuration, maxTurnsInput, update])

  const handleSandboxToggle = useCallback(
    (checked: boolean) => {
      if (!agentBase) return
      const next: AgentConfigurationState = { ...configuration, sandbox_enabled: checked }
      setConfiguration(next)
      update({ id: agentBase.id, configuration: next } satisfies UpdateAgentBaseForm)
    },
    [agentBase, configuration, update]
  )

  if (!agentBase) {
    return null
  }

  const sandboxEnabled = (configuration as CherryClawConfiguration).sandbox_enabled ?? false

  return (
    <SettingsContainer>
      {isCherryClaw && (
        <SettingsItem>
          <SettingsTitle
            contentAfter={
              <Tooltip title={t('agent.cherryClaw.sandbox.description')} placement="left">
                <Info size={16} className="text-foreground-400" />
              </Tooltip>
            }>
            {t('agent.cherryClaw.sandbox.label')}
          </SettingsTitle>
          <div className="flex items-center justify-between">
            <span className="text-foreground-500 text-xs">{t('agent.cherryClaw.sandbox.helper')}</span>
            <Switch checked={sandboxEnabled} size="small" onChange={handleSandboxToggle} />
          </div>
        </SettingsItem>
      )}
      <SettingsItem divider={false}>
        <SettingsTitle
          contentAfter={
            <Tooltip title={t('agent.settings.advance.maxTurns.description')} placement="left">
              <Info size={16} className="text-foreground-400" />
            </Tooltip>
          }>
          {t('agent.settings.advance.maxTurns.label')}
        </SettingsTitle>
        <div className="my-2 flex w-full flex-col gap-2">
          <InputNumber
            min={1}
            value={maxTurnsInput}
            onChange={(value) => setMaxTurnsInput(value ?? 1)}
            onBlur={commitMaxTurns}
            onPressEnter={commitMaxTurns}
            aria-label={t('agent.settings.advance.maxTurns.label')}
            style={{ width: '100%' }}
          />
          <span className="mt-1 text-foreground-500 text-xs">{t('agent.settings.advance.maxTurns.helper')}</span>
        </div>
      </SettingsItem>
    </SettingsContainer>
  )
}

export default AdvancedSettings
