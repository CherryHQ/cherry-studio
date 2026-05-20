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
  const [workerCommand, setWorkerCommand] = useState<string>('')
  const [workerArgsText, setWorkerArgsText] = useState<string>('')
  const [workerTagsText, setWorkerTagsText] = useState<string>('')

  useEffect(() => {
    if (!agentBase) {
      setConfiguration(defaultConfiguration)
      setMaxTurnsInput(defaultConfiguration.max_turns)
      setEnvVarsText('')
      setWorkerCommand('')
      setWorkerArgsText('')
      setWorkerTagsText('')
      return
    }
    const parsed: AgentConfigurationState = AgentConfigurationSchema.parse(agentBase.configuration ?? {})
    setConfiguration(parsed)
    setMaxTurnsInput(parsed.max_turns)
    setEnvVarsText(serializeKeyValueString(parsed.env_vars ?? {}))
    setWorkerCommand(typeof parsed.worker_command === 'string' ? parsed.worker_command : '')
    setWorkerArgsText(Array.isArray(parsed.worker_args) ? parsed.worker_args.join('\n') : '')
    setWorkerTagsText(Array.isArray(parsed.worker_capability_tags) ? parsed.worker_capability_tags.join(', ') : '')
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
    void update({ id: agentBase.id, configuration: next } satisfies UpdateAgentBaseForm)
  }, [agentBase, configuration, maxTurnsInput, update])

  const commitEnvVars = useCallback(() => {
    if (!agentBase) return
    const parsed = parseKeyValueString(envVarsText)
    const currentVars = configuration.env_vars ?? {}
    if (JSON.stringify(parsed) === JSON.stringify(currentVars)) return
    const next: AgentConfigurationState = { ...configuration, env_vars: parsed }
    setConfiguration(next)
    void update({ id: agentBase.id, configuration: next } satisfies UpdateAgentBaseForm)
  }, [agentBase, configuration, envVarsText, update])

  const commitWorkerCommand = useCallback(() => {
    if (!agentBase) return
    const sanitized = workerCommand.trim()
    if ((configuration.worker_command ?? '') === sanitized) {
      setWorkerCommand(sanitized)
      return
    }
    const next: AgentConfigurationState = {
      ...configuration,
      worker_command: sanitized || undefined
    }
    setConfiguration(next)
    setWorkerCommand(sanitized)
    void update({ id: agentBase.id, configuration: next } satisfies UpdateAgentBaseForm)
  }, [agentBase, configuration, update, workerCommand])

  const commitWorkerArgs = useCallback(() => {
    if (!agentBase) return
    const parsed = workerArgsText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    const currentArgs = Array.isArray(configuration.worker_args) ? configuration.worker_args : []
    if (JSON.stringify(parsed) === JSON.stringify(currentArgs)) {
      setWorkerArgsText(parsed.join('\n'))
      return
    }
    const next: AgentConfigurationState = {
      ...configuration,
      worker_args: parsed.length > 0 ? parsed : undefined
    }
    setConfiguration(next)
    setWorkerArgsText(parsed.join('\n'))
    void update({ id: agentBase.id, configuration: next } satisfies UpdateAgentBaseForm)
  }, [agentBase, configuration, update, workerArgsText])

  const commitWorkerTags = useCallback(() => {
    if (!agentBase) return
    const parsed = workerTagsText
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)
    const currentTags = Array.isArray(configuration.worker_capability_tags) ? configuration.worker_capability_tags : []
    if (JSON.stringify(parsed) === JSON.stringify(currentTags)) {
      setWorkerTagsText(parsed.join(', '))
      return
    }
    const next: AgentConfigurationState = {
      ...configuration,
      worker_capability_tags: parsed.length > 0 ? parsed : undefined
    }
    setConfiguration(next)
    setWorkerTagsText(parsed.join(', '))
    void update({ id: agentBase.id, configuration: next } satisfies UpdateAgentBaseForm)
  }, [agentBase, configuration, update, workerTagsText])

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
      <SettingsItem>
        <SettingsTitle>Worker Command</SettingsTitle>
        <div className="my-2 flex w-full flex-col gap-2">
          <Input
            value={workerCommand}
            onChange={(e) => setWorkerCommand(e.target.value)}
            onBlur={commitWorkerCommand}
            onPressEnter={commitWorkerCommand}
            placeholder="/opt/homebrew/bin/codex"
            aria-label="Worker Command"
          />
          <span className="mt-1 text-foreground-500 text-xs">
            CLI-backed workers use this executable. Leave empty for built-in Claude Code agents.
          </span>
        </div>
      </SettingsItem>
      <SettingsItem>
        <SettingsTitle>Worker Args</SettingsTitle>
        <div className="my-2 flex w-full flex-col gap-2">
          <TextArea
            rows={4}
            value={workerArgsText}
            onChange={(e) => setWorkerArgsText(e.target.value)}
            onBlur={commitWorkerArgs}
            placeholder={'run\n--cd\n{{cwd}}\n{{prompt}}'}
            aria-label="Worker Args"
            style={{ width: '100%' }}
          />
          <span className="mt-1 text-foreground-500 text-xs">
            {'One argument per line. Supports `{{prompt}}`, `{{cwd}}`, and `{{sessionId}}`.'}
          </span>
        </div>
      </SettingsItem>
      <SettingsItem divider={false}>
        <SettingsTitle>Capability Tags</SettingsTitle>
        <div className="my-2 flex w-full flex-col gap-2">
          <Input
            value={workerTagsText}
            onChange={(e) => setWorkerTagsText(e.target.value)}
            onBlur={commitWorkerTags}
            onPressEnter={commitWorkerTags}
            placeholder="code, music, review"
            aria-label="Capability Tags"
          />
          <span className="mt-1 text-foreground-500 text-xs">
            Comma-separated tags for later room routing. Example: `code, music, research`.
          </span>
        </div>
      </SettingsItem>
    </SettingsContainer>
  )
}

export default AdvancedSettings
