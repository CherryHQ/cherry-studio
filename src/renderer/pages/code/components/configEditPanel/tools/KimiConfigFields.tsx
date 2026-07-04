import type { FC } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { TogglePill } from '../TogglePill'
import { getRecord, makeUpdateField, makeUpdateSectionField } from './ConfigFieldPrimitives'

export interface KimiConfigFieldsProps {
  config: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  section?: 'all' | 'basic' | 'advanced'
}

export const KimiConfigFields: FC<KimiConfigFieldsProps> = ({ config, onChange, section = 'all' }) => {
  const { t } = useTranslation()

  const thinking = useMemo(() => getRecord(config.thinking), [config.thinking])
  const background = useMemo(() => getRecord(config.background), [config.background])
  const experimental = useMemo(() => getRecord(config.experimental), [config.experimental])

  const updateField = useMemo(() => makeUpdateField(config, onChange), [config, onChange])

  const updateSectionField = useMemo(() => makeUpdateSectionField(config, onChange), [config, onChange])

  if (section === 'advanced') return null

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        <TogglePill
          label={t('code.adv.kimi.plan_mode')}
          active={config.default_plan_mode === true}
          onClick={() => updateField('default_plan_mode', config.default_plan_mode === true ? undefined : true)}
        />
        <TogglePill
          label={t('code.adv.kimi.disable_telemetry')}
          active={config.telemetry === false}
          onClick={() => updateField('telemetry', config.telemetry === false ? undefined : false)}
        />
        <TogglePill
          label={t('code.adv.kimi.thinking')}
          active={thinking.enabled === true}
          onClick={() => updateSectionField('thinking', 'enabled', thinking.enabled === true ? undefined : true)}
        />
        <TogglePill
          label={t('code.adv.kimi.micro_compaction')}
          active={experimental.micro_compaction === true}
          onClick={() =>
            updateSectionField(
              'experimental',
              'micro_compaction',
              experimental.micro_compaction === true ? undefined : true
            )
          }
        />
        <TogglePill
          label={t('code.adv.kimi.keep_background_tasks')}
          active={background.keep_alive_on_exit === true}
          onClick={() =>
            updateSectionField(
              'background',
              'keep_alive_on_exit',
              background.keep_alive_on_exit === true ? undefined : true
            )
          }
        />
      </div>
    </div>
  )
}
