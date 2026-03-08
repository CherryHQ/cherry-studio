import { permissionModeCards } from '@renderer/config/agent'
import type { PermissionMode, UpdateAgentBaseForm } from '@renderer/types'
import { Tag } from 'antd'
import { uniq } from 'lodash'
import { CheckCircle, ShieldAlert } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  type AgentConfigurationState,
  type AgentOrSessionSettingsProps,
  computeModeDefaults,
  defaultConfiguration,
  SettingsContainer,
  SettingsItem,
  SettingsTitle
} from '../shared'

export const PermissionModeSettings: FC<AgentOrSessionSettingsProps> = ({ agentBase, update }) => {
  const { t } = useTranslation()
  const [isUpdatingMode, setIsUpdatingMode] = useState(false)

  const configuration = useMemo(() => agentBase?.configuration ?? defaultConfiguration, [agentBase?.configuration])
  const selectedMode = useMemo(
    () => agentBase?.configuration?.permission_mode ?? defaultConfiguration.permission_mode,
    [agentBase?.configuration?.permission_mode]
  )
  const availableTools = useMemo(() => agentBase?.tools ?? [], [agentBase?.tools])
  const autoToolIds = useMemo(() => computeModeDefaults(selectedMode, availableTools), [availableTools, selectedMode])
  const approvedToolIds = useMemo(() => {
    const allowed = agentBase?.allowed_tools ?? []
    const sanitized = allowed.filter((id) => availableTools.some((tool) => tool.id === id))
    const merged = uniq([...sanitized, ...autoToolIds])
    return merged
  }, [agentBase?.allowed_tools, autoToolIds, availableTools])
  const userAddedIds = useMemo(() => {
    return approvedToolIds.filter((id) => !autoToolIds.includes(id))
  }, [approvedToolIds, autoToolIds])

  const handleSelectPermissionMode = useCallback(
    (nextMode: PermissionMode) => {
      if (!agentBase || nextMode === selectedMode || isUpdatingMode) {
        return
      }
      const defaults = computeModeDefaults(nextMode, availableTools)
      const merged = uniq([...defaults, ...userAddedIds])
      const removedDefaults = autoToolIds.filter((id) => !defaults.includes(id))

      const applyChange = async () => {
        setIsUpdatingMode(true)
        try {
          const nextConfiguration = { ...configuration, permission_mode: nextMode } satisfies AgentConfigurationState
          await update({
            id: agentBase.id,
            configuration: nextConfiguration,
            allowed_tools: merged
          } satisfies UpdateAgentBaseForm)
        } finally {
          setIsUpdatingMode(false)
        }
      }

      if (removedDefaults.length > 0) {
        window.modal.confirm({
          title: t('agent.settings.tooling.permissionMode.confirmChange.title', 'Change permission mode?'),
          content: (
            <div className="flex flex-col gap-2">
              <p className="text-foreground-500 text-sm">
                {t(
                  'agent.settings.tooling.permissionMode.confirmChange.description',
                  'Switching modes updates the automatically approved tools.'
                )}
              </p>
              <div className="rounded-medium border border-default-200 bg-default-50 px-3 py-2 text-sm">
                <span className="font-medium text-foreground">{t('common.removed', 'Removed')}:</span>
                <ul className="mt-1 list-disc pl-4">
                  {removedDefaults.map((id) => {
                    const tool = availableTools.find((item) => item.id === id)
                    return (
                      <li className="text-foreground" key={id}>
                        {tool?.name ?? id}
                      </li>
                    )
                  })}
                </ul>
              </div>
            </div>
          ),
          centered: true,
          onOk: applyChange
        })
      } else {
        void applyChange()
      }
    },
    [agentBase, selectedMode, isUpdatingMode, availableTools, userAddedIds, autoToolIds, configuration, update, t]
  )

  if (!agentBase) {
    return null
  }

  return (
    <SettingsContainer>
      <SettingsItem divider={false}>
        <SettingsTitle>{t('agent.settings.permissionMode.title', 'Permission Mode')}</SettingsTitle>
        <div className="mt-2 flex flex-col gap-3">
          {permissionModeCards.map((card) => {
            const isSelected = card.mode === selectedMode
            const disabled = card.unsupported
            const showCaution = card.caution

            return (
              <div
                key={card.mode}
                className={`flex flex-col gap-2 overflow-hidden rounded-lg border p-4 transition-colors ${
                  isSelected
                    ? 'border-primary bg-primary-50/30 dark:bg-primary-950/20'
                    : 'border-default-200 hover:bg-default-50 dark:hover:bg-default-900/20'
                } ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                onClick={() => !disabled && handleSelectPermissionMode(card.mode)}>
                {/* Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="whitespace-normal break-words text-left font-semibold text-sm">
                      {t(card.titleKey, card.titleFallback)}
                    </span>
                    <span className="whitespace-normal break-words text-left text-[var(--color-text-2)] text-xs">
                      {t(card.descriptionKey, card.descriptionFallback)}
                    </span>
                  </div>
                  {disabled && <Tag color="warning">{t('common.coming_soon', 'Coming soon')}</Tag>}
                  {isSelected && !disabled && <CheckCircle className="flex-shrink-0 text-primary" size={20} />}
                </div>

                {/* Body */}
                {showCaution && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-start gap-2 rounded-md bg-[var(--color-error-bg)]">
                      <ShieldAlert className="flex-shrink-0 text-[var(--color-error)]" size={16} />
                      <span className="text-[var(--color-error)] text-xs">
                        {t(
                          'agent.settings.tooling.permissionMode.bypassPermissions.warning',
                          'Use with caution — all tools will run without asking for approval.'
                        )}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </SettingsItem>
    </SettingsContainer>
  )
}

export default PermissionModeSettings
