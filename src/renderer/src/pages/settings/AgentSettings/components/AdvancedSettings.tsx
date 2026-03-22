import type { UpdateAgentBaseForm } from '@renderer/types'
import { AgentConfigurationSchema } from '@renderer/types'
import { parseKeyValueString, serializeKeyValueString } from '@renderer/utils/env'
import { Input, InputNumber, Tooltip } from 'antd'
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

const { TextArea } = Input

export const AdvancedSettings: React.FC<AgentOrSessionSettingsProps> = ({ agentBase, update }) => {
  const { t } = useTranslation()
  const [configuration, setConfiguration] = useState<AgentConfigurationState>(defaultConfiguration)
  const [maxTurnsInput, setMaxTurnsInput] = useState<number>(defaultConfiguration.max_turns)
  const [envVarsText, setEnvVarsText] = useState<string>('')

  useEffect(() => {
    if (!agentBase) {
      setConfiguration(defaultConfiguration)
      setMaxTurnsInput(defaultConfiguration.max_turns)
      setEnvVarsText('')
      return
    }
    const parsed: AgentConfigurationState = AgentConfigurationSchema.parse(agentBase.configuration ?? {})
    setConfiguration(parsed)
    setMaxTurnsInput(parsed.max_turns)
    setEnvVarsText(serializeKeyValueString(parsed.env_vars ?? {}))
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

  const commitEnvVars = useCallback(() => {
    if (!agentBase) return
    const parsed = parseKeyValueString(envVarsText)
    const currentVars = configuration.env_vars ?? {}
    if (JSON.stringify(parsed) === JSON.stringify(currentVars)) return
    const next: AgentConfigurationState = { ...configuration, env_vars: parsed }
    setConfiguration(next)
    update({ id: agentBase.id, configuration: next } satisfies UpdateAgentBaseForm)
  }, [agentBase, configuration, envVarsText, update])

  if (!agentBase) {
    return null
  }

  return (
    <SettingsContainer>
      <SettingsItem>
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
      <SettingsItem divider={false}>
        <SettingsTitle
          contentAfter={
            <Tooltip title={t('agent.settings.advance.envVars.description')} placement="left">
              <Info size={16} className="text-foreground-400" />
            </Tooltip>
          }>
          {t('agent.settings.advance.envVars.label')}
        </SettingsTitle>
        <div className="my-2 flex w-full flex-col gap-2">
          <TextArea
            rows={4}
            value={envVarsText}
            onChange={(e) => setEnvVarsText(e.target.value)}
            onBlur={commitEnvVars}
            placeholder={'API_KEY=xxx\nDEBUG=true'}
            aria-label={t('agent.settings.advance.envVars.label')}
            style={{ width: '100%' }}
          />
          <span className="mt-1 text-foreground-500 text-xs">{t('agent.settings.advance.envVars.helper')}</span>
        </div>
      </SettingsItem>
    </SettingsContainer>
  )
}

export default AdvancedSettings
