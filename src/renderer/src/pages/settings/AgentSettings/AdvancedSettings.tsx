import type { useUpdateAgent } from '@renderer/hooks/agents/useUpdateAgent'
import type { useUpdateSession } from '@renderer/hooks/agents/useUpdateSession'
import type {
  AgentConfiguration,
  GetAgentResponse,
  GetAgentSessionResponse,
  UpdateAgentBaseForm
} from '@renderer/types'
import { AgentConfigurationSchema } from '@renderer/types'
import { InputNumber, Tooltip } from 'antd'
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
      update: ReturnType<typeof useUpdateSession>['updateSession']
    }

const defaultConfiguration: AgentConfigurationState = AgentConfigurationSchema.parse({})

export const AdvancedSettings: React.FC<AdvancedSettingsProps> = ({ agentBase, update }) => {
  const { t } = useTranslation()
  const [configuration, setConfiguration] = useState<AgentConfigurationState>(defaultConfiguration)
  const [maxTurnsInput, setMaxTurnsInput] = useState<number>(defaultConfiguration.max_turns)

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

  if (!agentBase) {
    return null
  }

  return (
    <SettingsContainer>
      <SettingsItem divider={false}>
        <SettingsTitle
          actions={
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
