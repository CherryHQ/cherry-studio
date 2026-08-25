import { KIMI_PERMISSION_MODES } from '@renderer/pages/code/cliConfig'
import type { FC } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { TogglePill } from '../TogglePill'
import { ConfigSelectField } from './ConfigFieldPrimitives'
import { getRecord, makeUpdateField, makeUpdateSectionField } from './configFieldUtils'

export interface KimiConfigFieldsProps {
  config: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  section?: 'all' | 'basic' | 'advanced'
}

const PERMISSION_MODE_LABEL_KEYS: Record<(typeof KIMI_PERMISSION_MODES)[number], string> = {
  manual: 'code.adv.permission_modes.manual',
  auto: 'code.adv.permission_modes.auto',
  yolo: 'code.adv.permission_modes.yolo_high_risk'
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
      <ConfigSelectField
        label={t('code.adv.permission_mode')}
        value={typeof config.default_permission_mode === 'string' ? config.default_permission_mode : undefined}
        placeholder={t('code.adv.select_placeholder')}
        options={KIMI_PERMISSION_MODES.map((mode) => ({
          value: mode,
          label: t(PERMISSION_MODE_LABEL_KEYS[mode])
        }))}
        onChange={(value) => updateField('default_permission_mode', value)}
      />
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
