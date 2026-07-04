import type { FC } from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { TogglePill } from '../TogglePill'
import { getRecord, makeUpdateSectionField } from './ConfigFieldPrimitives'

export interface QwenConfigFieldsProps {
  config: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  section?: 'all' | 'basic' | 'advanced'
}

export const QwenConfigFields: FC<QwenConfigFieldsProps> = ({ config, onChange, section = 'all' }) => {
  const { t } = useTranslation()

  const general = useMemo(() => getRecord(config.general), [config.general])
  const ui = useMemo(() => getRecord(config.ui), [config.ui])
  const privacy = useMemo(() => getRecord(config.privacy), [config.privacy])
  const permissions = useMemo(() => getRecord(config.permissions), [config.permissions])
  const autoMode = useMemo(() => getRecord(permissions.autoMode), [permissions.autoMode])

  const updateSectionField = useMemo(() => makeUpdateSectionField(config, onChange), [config, onChange])

  const updateAutoModeField = useCallback(
    (key: string, value: boolean | undefined) => {
      const nextPermissions = { ...permissions }
      const nextAutoMode: Record<string, unknown> = {}
      if (value !== undefined) nextAutoMode[key] = value
      if (Object.keys(nextAutoMode).length > 0) nextPermissions.autoMode = nextAutoMode
      else delete nextPermissions.autoMode

      const next = { ...config }
      if (Object.keys(nextPermissions).length > 0) next.permissions = nextPermissions
      else delete next.permissions
      onChange(next)
    },
    [config, onChange, permissions]
  )

  const usageStatsDisabled = privacy.usageStatisticsEnabled === false

  if (section === 'advanced') return null

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        <TogglePill
          label={t('code.adv.qwen.vim_mode')}
          active={general.vimMode === true}
          onClick={() => updateSectionField('general', 'vimMode', general.vimMode === true ? undefined : true)}
        />
        <TogglePill
          label={t('code.adv.qwen.hide_banner')}
          active={ui.hideBanner === true}
          onClick={() => updateSectionField('ui', 'hideBanner', ui.hideBanner === true ? undefined : true)}
        />
        <TogglePill
          label={t('code.adv.qwen.disable_usage_stats')}
          active={usageStatsDisabled}
          onClick={() =>
            updateSectionField('privacy', 'usageStatisticsEnabled', usageStatsDisabled ? undefined : false)
          }
        />
        <TogglePill
          label={t('code.adv.qwen.disable_auto_update')}
          active={general.enableAutoUpdate === false}
          onClick={() =>
            updateSectionField('general', 'enableAutoUpdate', general.enableAutoUpdate === false ? undefined : false)
          }
        />
        <TogglePill
          label={t('code.adv.qwen.classify_all_shell')}
          active={autoMode.classifyAllShell === true}
          onClick={() => updateAutoModeField('classifyAllShell', autoMode.classifyAllShell === true ? undefined : true)}
        />
      </div>
    </div>
  )
}
