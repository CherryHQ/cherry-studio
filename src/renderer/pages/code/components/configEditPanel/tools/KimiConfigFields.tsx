import { Input, SelectDropdown } from '@cherrystudio/ui'
import type { FC } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AdvancedConfigToggle } from '../AdvancedConfigToggle'
import { TogglePill } from '../TogglePill'
import { Field, getRecord } from './ConfigFieldPrimitives'

export interface KimiConfigFieldsProps {
  config: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
}

const PERMISSION_MODE_OPTIONS = ['manual', 'auto', 'yolo'] as const
const THINKING_EFFORT_OPTIONS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

const permissionModeItems = PERMISSION_MODE_OPTIONS.map((id) => ({ id }))
const thinkingEffortItems = THINKING_EFFORT_OPTIONS.map((id) => ({ id }))

export const KimiConfigFields: FC<KimiConfigFieldsProps> = ({ config, onChange }) => {
  const { t } = useTranslation()
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const thinking = useMemo(() => getRecord(config.thinking), [config.thinking])
  const loopControl = useMemo(() => getRecord(config.loop_control), [config.loop_control])
  const background = useMemo(() => getRecord(config.background), [config.background])
  const experimental = useMemo(() => getRecord(config.experimental), [config.experimental])

  const updateField = useCallback(
    (key: string, value: string | number | boolean | undefined) => {
      const next = { ...config }
      if (value !== undefined && value !== '') next[key] = value
      else delete next[key]
      onChange(next)
    },
    [config, onChange]
  )

  const updateSectionField = useCallback(
    (section: string, key: string, value: string | number | boolean | undefined) => {
      const next = { ...config }
      const sectionValue = { ...getRecord(next[section]) }
      if (value !== undefined && value !== '') sectionValue[key] = value
      else delete sectionValue[key]
      if (Object.keys(sectionValue).length > 0) next[section] = sectionValue
      else delete next[section]
      onChange(next)
    },
    [config, onChange]
  )

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

      <AdvancedConfigToggle open={advancedOpen} onToggle={() => setAdvancedOpen((o) => !o)}>
        <div className="flex gap-3">
          <Field label={t('code.adv.kimi.permission_mode_hint')}>
            <SelectDropdown
              items={permissionModeItems}
              selectedId={
                typeof config.default_permission_mode === 'string' ? config.default_permission_mode : undefined
              }
              onSelect={(v) => updateField('default_permission_mode', v)}
              placeholder={t('code.adv.select_placeholder')}
              renderSelected={(item) => t(`code.adv.kimi.permission_${item.id}`)}
              renderItem={(item) => t(`code.adv.kimi.permission_${item.id}`)}
            />
          </Field>
          <Field label={t('code.adv.kimi.thinking_effort_hint')}>
            <SelectDropdown
              items={thinkingEffortItems}
              selectedId={typeof thinking.effort === 'string' ? thinking.effort : undefined}
              onSelect={(v) => updateSectionField('thinking', 'effort', v)}
              placeholder={t('code.adv.select_placeholder')}
              renderSelected={(item) => item.id}
              renderItem={(item) => item.id}
            />
          </Field>
        </div>

        <div className="mt-3 flex gap-3">
          <Field label={t('code.adv.kimi.max_steps_hint')}>
            <Input
              value={typeof loopControl.max_steps_per_turn === 'number' ? String(loopControl.max_steps_per_turn) : ''}
              onChange={(e) => {
                const v = e.target.value
                updateSectionField('loop_control', 'max_steps_per_turn', v ? Number(v) : undefined)
              }}
              placeholder="0"
              type="number"
              autoComplete="off"
              className="h-9 text-sm"
            />
          </Field>
          <Field label={t('code.adv.kimi.max_retries_hint')}>
            <Input
              value={
                typeof loopControl.max_retries_per_step === 'number' ? String(loopControl.max_retries_per_step) : ''
              }
              onChange={(e) => {
                const v = e.target.value
                updateSectionField('loop_control', 'max_retries_per_step', v ? Number(v) : undefined)
              }}
              placeholder="3"
              type="number"
              autoComplete="off"
              className="h-9 text-sm"
            />
          </Field>
        </div>

        <div className="mt-3 flex gap-3">
          <Field label={t('code.adv.kimi.reserved_context_hint')}>
            <Input
              value={
                typeof loopControl.reserved_context_size === 'number' ? String(loopControl.reserved_context_size) : ''
              }
              onChange={(e) => {
                const v = e.target.value
                updateSectionField('loop_control', 'reserved_context_size', v ? Number(v) : undefined)
              }}
              placeholder="50000"
              type="number"
              autoComplete="off"
              className="h-9 text-sm"
            />
          </Field>
          <Field label={t('code.adv.kimi.max_background_tasks_hint')}>
            <Input
              value={typeof background.max_running_tasks === 'number' ? String(background.max_running_tasks) : ''}
              onChange={(e) => {
                const v = e.target.value
                updateSectionField('background', 'max_running_tasks', v ? Number(v) : undefined)
              }}
              placeholder="4"
              type="number"
              autoComplete="off"
              className="h-9 text-sm"
            />
          </Field>
        </div>
      </AdvancedConfigToggle>
    </div>
  )
}
