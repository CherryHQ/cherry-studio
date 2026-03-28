import type {
  AgentBaseWithId,
  CherryClawConfiguration,
  UpdateAgentBaseForm,
  UpdateAgentFunctionUnion
} from '@renderer/types'
import { Switch, Tooltip } from 'antd'
import { Info } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { isSoulModeEnabled, SettingsItem, SettingsTitle } from '../shared'

interface SoulModeSettingProps {
  base: AgentBaseWithId | undefined | null
  update: UpdateAgentFunctionUnion
}

export const SoulModeSetting = ({ base: agentBase, update }: SoulModeSettingProps) => {
  const { t } = useTranslation()

  const config = (agentBase?.configuration ?? {}) as CherryClawConfiguration
  const soulEnabled = isSoulModeEnabled(agentBase?.configuration)

  const handleToggle = useCallback(
    (checked: boolean) => {
      if (!agentBase) return
      update({
        id: agentBase.id,
        configuration: { ...config, soul_enabled: checked }
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
