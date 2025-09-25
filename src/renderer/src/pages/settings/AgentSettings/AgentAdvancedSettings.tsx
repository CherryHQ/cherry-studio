import { Input, Tooltip } from '@heroui/react'
import { AgentConfiguration, AgentConfigurationSchema, GetAgentResponse, UpdateAgentForm } from '@renderer/types'
import { Info } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingsContainer, SettingsItem, SettingsTitle } from './shared'

type AgentConfigurationState = AgentConfiguration & Record<string, unknown>

interface AgentAdvancedSettingsProps {
  agent: GetAgentResponse | undefined | null
  updateAgent: (form: UpdateAgentForm) => Promise<void> | void
}

const defaultConfiguration = AgentConfigurationSchema.parse({}) as AgentConfigurationState

export const AgentAdvancedSettings: React.FC<AgentAdvancedSettingsProps> = ({ agent, updateAgent }) => {
  const { t } = useTranslation()
  const [configuration, setConfiguration] = useState<AgentConfigurationState>(defaultConfiguration)
  const [maxTurnsInput, setMaxTurnsInput] = useState<string>(String(defaultConfiguration.max_turns))

  useEffect(() => {
    if (!agent) {
      setConfiguration(defaultConfiguration)
      setMaxTurnsInput(String(defaultConfiguration.max_turns))
      return
    }
    const parsed = AgentConfigurationSchema.parse(agent.configuration ?? {}) as AgentConfigurationState
    setConfiguration(parsed)
    setMaxTurnsInput(String(parsed.max_turns))
  }, [agent])

  const commitMaxTurns = useCallback(() => {
    if (!agent) return
    const parsedValue = Number.parseInt(maxTurnsInput, 10)
    if (!Number.isFinite(parsedValue)) {
      setMaxTurnsInput(String(configuration.max_turns))
      return
    }
    const sanitized = Math.max(1, parsedValue)
    if (sanitized === configuration.max_turns) {
      setMaxTurnsInput(String(configuration.max_turns))
      return
    }
    const next = { ...configuration, max_turns: sanitized } as AgentConfigurationState
    setConfiguration(next)
    setMaxTurnsInput(String(sanitized))
    updateAgent({ id: agent.id, configuration: next } satisfies UpdateAgentForm)
  }, [agent, configuration, maxTurnsInput, updateAgent])

  if (!agent) {
    return null
  }

  return (
    <SettingsContainer>
      <SettingsItem divider={false}>
        <SettingsTitle
          actions={
            <Tooltip content={t('agent.settings.advance.maxTurns.description')} placement="right">
              <Info size={16} className="text-foreground-400" />
            </Tooltip>
          }>
          {t('agent.settings.advance.maxTurns.label')}
        </SettingsTitle>
        <div className="flex w-full flex-col gap-2">
          <Input
            type="number"
            min={1}
            value={maxTurnsInput}
            onValueChange={setMaxTurnsInput}
            onBlur={commitMaxTurns}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                commitMaxTurns()
              }
            }}
            aria-label={t('agent.settings.advance.maxTurns.label')}
          />
          <span className="text-foreground-500 text-xs">{t('agent.settings.advance.maxTurns.helper')}</span>
        </div>
      </SettingsItem>
    </SettingsContainer>
  )
}

export default AgentAdvancedSettings
