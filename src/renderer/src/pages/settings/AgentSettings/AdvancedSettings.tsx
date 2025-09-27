import { Input, Tooltip } from '@heroui/react'
import { useUpdateAgent } from '@renderer/hooks/agents/useUpdateAgent'
import { useUpdateSession } from '@renderer/hooks/agents/useUpdateSession'
import {
  AgentConfiguration,
  AgentConfigurationSchema,
  GetAgentResponse,
  GetAgentSessionResponse,
  UpdateAgentBaseForm
} from '@renderer/types'
import { Info } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingsContainer, SettingsItem, SettingsTitle } from './shared'

type AgentConfigurationState = AgentConfiguration & Record<string, unknown>

type AdvancedSettingsProps =
  | {
      agentBase: GetAgentResponse | undefined | null
      update: ReturnType<typeof useUpdateAgent>['updateAgent']
    }
  | {
      agentBase: GetAgentSessionResponse | undefined | null
      update: ReturnType<typeof useUpdateSession>
    }

const defaultConfiguration: AgentConfigurationState = AgentConfigurationSchema.parse({})

export const AdvancedSettings: React.FC<AdvancedSettingsProps> = ({ agentBase, update }) => {
  const { t } = useTranslation()
  const [configuration, setConfiguration] = useState<AgentConfigurationState>(defaultConfiguration)
  const [maxTurnsInput, setMaxTurnsInput] = useState<string>(String(defaultConfiguration.max_turns))

  useEffect(() => {
    if (!agentBase) {
      setConfiguration(defaultConfiguration)
      setMaxTurnsInput(String(defaultConfiguration.max_turns))
      return
    }
    const parsed: AgentConfigurationState = AgentConfigurationSchema.parse(agentBase.configuration ?? {})
    setConfiguration(parsed)
    setMaxTurnsInput(String(parsed.max_turns))
  }, [agentBase])

  const commitMaxTurns = useCallback(() => {
    if (!agentBase) return
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
    const next: AgentConfigurationState = { ...configuration, max_turns: sanitized }
    setConfiguration(next)
    setMaxTurnsInput(String(sanitized))
    update({ id: agentBase.id, configuration: next } satisfies UpdateAgentBaseForm)
  }, [agentBase, configuration, maxTurnsInput, update])

  if (!agentBase) {
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

export default AdvancedSettings
