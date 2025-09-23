import { Input, Select, SelectItem, Tooltip } from '@heroui/react'
import type { Selection } from '@react-types/shared'
import {
  AgentConfiguration,
  AgentConfigurationSchema,
  GetAgentResponse,
  PermissionMode,
  PermissionModeSchema,
  UpdateAgentForm
} from '@renderer/types'
import { Info } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingsContainer, SettingsItem, SettingsTitle } from './shared'

const permissionModeKeyMap: Record<PermissionMode, string> = {
  default: 'agent.settings.advance.permissionMode.options.default',
  acceptEdits: 'agent.settings.advance.permissionMode.options.acceptEdits',
  bypassPermissions: 'agent.settings.advance.permissionMode.options.bypassPermissions',
  plan: 'agent.settings.advance.permissionMode.options.plan'
}

const permissionModeFallback: Record<PermissionMode, string> = {
  default: 'Default (ask before continuing)',
  acceptEdits: 'Accept edits automatically',
  bypassPermissions: 'Bypass permission checks',
  plan: 'Planning mode (requires plan approval)'
}

type AgentConfigurationState = AgentConfiguration & Record<string, unknown>

interface AgentAdvanceSettingsProps {
  agent: GetAgentResponse | undefined | null
  updateAgent: (form: UpdateAgentForm) => Promise<void> | void
}

const defaultConfiguration = AgentConfigurationSchema.parse({}) as AgentConfigurationState

export const AgentAdvanceSettings: React.FC<AgentAdvanceSettingsProps> = ({ agent, updateAgent }) => {
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

  const permissionOptions = useMemo(
    () =>
      PermissionModeSchema.options.map((mode) => ({
        key: mode,
        label: t(permissionModeKeyMap[mode], permissionModeFallback[mode])
      })) satisfies { key: PermissionMode; label: string }[],
    [t]
  )

  const handlePermissionChange = useCallback(
    (keys: Selection) => {
      if (!agent || keys === 'all') return
      const [first] = Array.from(keys)
      if (!first) return
      const nextMode = first as PermissionMode
      setConfiguration((prev) => {
        if (prev.permission_mode === nextMode) {
          return prev
        }
        const next = { ...prev, permission_mode: nextMode } as AgentConfigurationState
        updateAgent({ id: agent.id, configuration: next } satisfies UpdateAgentForm)
        return next
      })
    },
    [agent, updateAgent]
  )

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
      <SettingsItem>
        <SettingsTitle
          actions={
            <Tooltip content={t('agent.settings.advance.permissionMode.description')} placement="right">
              <Info size={16} className="text-foreground-400" />
            </Tooltip>
          }>
          {t('agent.settings.advance.permissionMode.label')}
        </SettingsTitle>
        <Select
          aria-label={t('agent.settings.advance.permissionMode.label')}
          selectionMode="single"
          selectedKeys={[configuration.permission_mode]}
          onSelectionChange={handlePermissionChange}
          className="max-w-md"
          placeholder={t('agent.settings.advance.permissionMode.placeholder')}>
          {permissionOptions.map((option) => (
            <SelectItem key={option.key} textValue={option.label}>
              {option.label}
            </SelectItem>
          ))}
        </Select>
      </SettingsItem>
      <SettingsItem divider={false}>
        <SettingsTitle
          actions={
            <Tooltip content={t('agent.settings.advance.maxTurns.description')} placement="right">
              <Info size={16} className="text-foreground-400" />
            </Tooltip>
          }>
          {t('agent.settings.advance.maxTurns.label')}
        </SettingsTitle>
        <div className="flex max-w-md flex-col gap-2">
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
          <span className="text-foreground-500 text-xs">
            {t('agent.settings.advance.maxTurns.helper')}
          </span>
        </div>
      </SettingsItem>
    </SettingsContainer>
  )
}

export default AgentAdvanceSettings
