import type {
  AgentBaseWithId,
  AgentConfiguration,
  UpdateAgentBaseForm,
  UpdateAgentFunctionUnion
} from '@renderer/types'
import { Switch, Tooltip } from 'antd'
import { Info } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { isSoulModeEnabled, SettingsItem, SettingsTitle } from '../shared'

interface SoulModeSettingProps {
  base: AgentBaseWithId | undefined | null
  update: UpdateAgentFunctionUnion
}

export const SoulModeSetting = ({ base: agentBase, update }: SoulModeSettingProps) => {
  const { t } = useTranslation()

  const config = useMemo(() => agentBase?.configuration ?? ({} as AgentConfiguration), [agentBase?.configuration])
  const soulEnabled = isSoulModeEnabled(agentBase?.configuration)

  const handleToggle = useCallback(
    (checked: boolean) => {
      if (!agentBase) return
      void update({
        id: agentBase.id,
        configuration: {
          ...config,
          soul_enabled: checked,
          ...(checked ? { permission_mode: 'bypassPermissions' as const } : {})
        }
      } satisfies UpdateAgentBaseForm)
    },
    [agentBase, config, update]
  )

  if (!agentBase) return null

  return (
    <SettingsItem inline>
      <SettingsTitle
        contentAfter={
          <Tooltip title={t('agent.settings.soulMode.description')} placement="right">
            <Info size={16} className="text-foreground-400" />
          </Tooltip>
        }>
        {t('agent.settings.soulMode.title')}
      </SettingsTitle>
      <Switch checked={soulEnabled} size="small" onChange={handleToggle} />
    </SettingsItem>
  )
}
