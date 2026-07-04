import type { FC } from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { TogglePill } from '../TogglePill'
import { getRecord, makeUpdateSectionField } from './ConfigFieldPrimitives'

export interface GeminiConfigFieldsProps {
  config: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  section?: 'all' | 'basic' | 'advanced'
}

export const GeminiConfigFields: FC<GeminiConfigFieldsProps> = ({ config, onChange, section = 'all' }) => {
  const { t } = useTranslation()

  const general = useMemo(() => getRecord(config.general), [config.general])
  const ui = useMemo(() => getRecord(config.ui), [config.ui])
  const privacy = useMemo(() => getRecord(config.privacy), [config.privacy])

  const updateSectionField = useMemo(() => makeUpdateSectionField(config, onChange), [config, onChange])

  const toggleBoolean = useCallback(
    (section: string, key: string, active: boolean, onValue: boolean, offValue?: boolean) => {
      updateSectionField(section, key, active ? offValue : onValue)
    },
    [updateSectionField]
  )

  const checkpointing = getRecord(general.checkpointing)
  const checkpointingEnabled = checkpointing.enabled === true
  const usageStatsDisabled = privacy.usageStatisticsEnabled === false

  if (section === 'advanced') return null

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        <TogglePill
          label={t('code.adv.gemini.vim_mode')}
          active={general.vimMode === true}
          onClick={() => toggleBoolean('general', 'vimMode', general.vimMode === true, true)}
        />
        <TogglePill
          label={t('code.adv.gemini.hide_banner')}
          active={ui.hideBanner === true}
          onClick={() => toggleBoolean('ui', 'hideBanner', ui.hideBanner === true, true)}
        />
        <TogglePill
          label={t('code.adv.gemini.disable_usage_stats')}
          active={usageStatsDisabled}
          onClick={() => toggleBoolean('privacy', 'usageStatisticsEnabled', usageStatsDisabled, false)}
        />
        <TogglePill
          label={t('code.adv.gemini.checkpointing')}
          active={checkpointingEnabled}
          onClick={() =>
            updateSectionField('general', 'checkpointing', checkpointingEnabled ? undefined : { enabled: true })
          }
        />
      </div>
    </div>
  )
}
