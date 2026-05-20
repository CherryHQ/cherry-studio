import type { PermissionMode, UpdateAgentBaseForm } from '@renderer/types'
import { Switch } from 'antd'
import { uniq } from 'lodash'
import type { FC } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  type AgentConfigurationState,
  type AgentOrSessionSettingsProps,
  computeModeDefaults,
  defaultConfiguration,
  SettingsContainer,
  SettingsItem
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
          const nextConfiguration: AgentConfigurationState = { ...configuration, permission_mode: nextMode }

          // Disable soul mode when switching away from bypassPermissions
          if (nextMode !== 'bypassPermissions' && configuration.soul_enabled === true) {
            nextConfiguration.soul_enabled = false
          }
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
      <SettingsItem divider={false} style={{ padding: '8px 0' }}>
        <div className="flex items-center justify-between gap-6 w-full">
          <div className="flex flex-col gap-1.5 flex-1 pr-4">
            <span className="text-[14px] font-medium text-[var(--color-text)]">自动审核</span>
            <span className="text-[12px] leading-relaxed text-[var(--color-text-2)]">
              {agentBase.name || 'Agent'} 可以读取和编辑其工作区中的文件。{agentBase.name || 'Agent'}{' '}
              会自动审核额外访问权限请求。自动审核可能会出错。
              <a href="#" className="text-primary hover:underline cursor-help ml-1">
                了解更多有关高风险的信息。
              </a>
            </span>
          </div>
          <div className="flex-shrink-0">
            <Switch
              checked={selectedMode === 'bypassPermissions'}
              onChange={(checked) => handleSelectPermissionMode(checked ? 'bypassPermissions' : 'default')}
            />
          </div>
        </div>
      </SettingsItem>
    </SettingsContainer>
  )
}

export default PermissionModeSettings
