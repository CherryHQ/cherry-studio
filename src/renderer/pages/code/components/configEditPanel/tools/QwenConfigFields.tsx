import { Input, SelectDropdown } from '@cherrystudio/ui'
import type { FC } from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { TogglePill } from '../TogglePill'
import { Field, formatCommaList, getRecord, makeUpdateSectionField, parseCommaList } from './ConfigFieldPrimitives'

export interface QwenConfigFieldsProps {
  config: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  section?: 'all' | 'basic' | 'advanced'
}

const APPROVAL_MODE_OPTIONS = ['default', 'auto-edit', 'auto', 'plan', 'yolo'] as const
const approvalModeItems = APPROVAL_MODE_OPTIONS.map((id) => ({ id }))

export const QwenConfigFields: FC<QwenConfigFieldsProps> = ({ config, onChange, section = 'all' }) => {
  const { t } = useTranslation()

  const general = useMemo(() => getRecord(config.general), [config.general])
  const ui = useMemo(() => getRecord(config.ui), [config.ui])
  const privacy = useMemo(() => getRecord(config.privacy), [config.privacy])
  const tools = useMemo(() => getRecord(config.tools), [config.tools])
  const context = useMemo(() => getRecord(config.context), [config.context])
  const permissions = useMemo(() => getRecord(config.permissions), [config.permissions])
  const autoMode = useMemo(() => getRecord(permissions.autoMode), [permissions.autoMode])
  const autoModeHints = useMemo(() => getRecord(autoMode.hints), [autoMode.hints])

  const updateSectionField = useMemo(() => makeUpdateSectionField(config, onChange), [config, onChange])

  const updateAutoModeField = useCallback(
    (key: string, value: boolean | string[] | Record<string, unknown> | undefined) => {
      const nextPermissions = { ...permissions }
      const nextAutoMode = { ...autoMode }
      if (value !== undefined) nextAutoMode[key] = value
      else delete nextAutoMode[key]
      if (Object.keys(nextAutoMode).length > 0) nextPermissions.autoMode = nextAutoMode
      else delete nextPermissions.autoMode

      const next = { ...config }
      if (Object.keys(nextPermissions).length > 0) next.permissions = nextPermissions
      else delete next.permissions
      onChange(next)
    },
    [autoMode, config, onChange, permissions]
  )

  const updateAutoModeHint = useCallback(
    (key: string, value: string[]) => {
      const nextHints = { ...autoModeHints }
      if (value.length > 0) nextHints[key] = value
      else delete nextHints[key]
      updateAutoModeField('hints', Object.keys(nextHints).length > 0 ? nextHints : undefined)
    },
    [autoModeHints, updateAutoModeField]
  )

  const usageStatsDisabled = privacy.usageStatisticsEnabled === false

  return (
    <div className="space-y-3">
      {section !== 'advanced' && (
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
            onClick={() =>
              updateAutoModeField('classifyAllShell', autoMode.classifyAllShell === true ? undefined : true)
            }
          />
        </div>
      )}

      {section !== 'basic' && (
        <>
          <div className="flex gap-3">
            <Field label={t('code.adv.qwen.approval_mode_hint')}>
              <SelectDropdown
                items={approvalModeItems}
                selectedId={typeof tools.approvalMode === 'string' ? tools.approvalMode : undefined}
                onSelect={(v) => updateSectionField('tools', 'approvalMode', v)}
                placeholder={t('code.adv.select_placeholder')}
                renderSelected={(item) => t(`code.adv.qwen.approval_${item.id}`)}
                renderItem={(item) => t(`code.adv.qwen.approval_${item.id}`)}
              />
            </Field>
            <Field label={t('code.adv.qwen.preferred_editor_hint')}>
              <Input
                value={typeof general.preferredEditor === 'string' ? general.preferredEditor : ''}
                onChange={(e) => updateSectionField('general', 'preferredEditor', e.target.value)}
                placeholder="code"
                autoComplete="off"
                className="h-9 text-sm"
              />
            </Field>
          </div>

          <div className="mt-3 flex gap-3">
            <Field label={t('code.adv.qwen.output_language_hint')}>
              <Input
                value={typeof general.outputLanguage === 'string' ? general.outputLanguage : ''}
                onChange={(e) => updateSectionField('general', 'outputLanguage', e.target.value)}
                placeholder="auto"
                autoComplete="off"
                className="h-9 text-sm"
              />
            </Field>
            <Field label={t('code.adv.qwen.cleanup_days_hint')}>
              <Input
                value={typeof general.cleanupPeriodDays === 'number' ? String(general.cleanupPeriodDays) : ''}
                onChange={(e) => {
                  const v = e.target.value
                  updateSectionField('general', 'cleanupPeriodDays', v ? Number(v) : undefined)
                }}
                placeholder="30"
                type="number"
                autoComplete="off"
                className="h-9 text-sm"
              />
            </Field>
          </div>

          <Field label={t('code.adv.qwen.context_files_hint')} className="mt-3 block w-full flex-none">
            <Input
              value={formatCommaList(context.fileName)}
              onChange={(e) => updateSectionField('context', 'fileName', parseCommaList(e.target.value))}
              placeholder="QWEN.md, AGENTS.md"
              autoComplete="off"
              className="h-9 text-sm"
            />
          </Field>

          <div className="mt-3 flex gap-3">
            <Field label={t('code.adv.qwen.auto_mode_allow_hint')}>
              <Input
                value={formatCommaList(autoModeHints.allow)}
                onChange={(e) => updateAutoModeHint('allow', parseCommaList(e.target.value))}
                placeholder={t('code.adv.qwen.auto_mode_allow_placeholder')}
                autoComplete="off"
                className="h-9 text-sm"
              />
            </Field>
            <Field label={t('code.adv.qwen.auto_mode_deny_hint')}>
              <Input
                value={formatCommaList(autoModeHints.softDeny)}
                onChange={(e) => updateAutoModeHint('softDeny', parseCommaList(e.target.value))}
                placeholder={t('code.adv.qwen.auto_mode_deny_placeholder')}
                autoComplete="off"
                className="h-9 text-sm"
              />
            </Field>
          </div>
        </>
      )}
    </div>
  )
}
