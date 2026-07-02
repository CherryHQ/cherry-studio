import { Input, SelectDropdown } from '@cherrystudio/ui'
import type { FC } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AdvancedConfigToggle } from '../AdvancedConfigToggle'
import { TogglePill } from '../TogglePill'
import { Field, formatCommaList, getRecord, parseCommaList } from './ConfigFieldPrimitives'

export interface GeminiConfigFieldsProps {
  config: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
}

const APPROVAL_MODE_OPTIONS = ['default', 'auto_edit', 'plan'] as const
const EDITOR_OPTIONS = [
  'vscode',
  'vscodium',
  'windsurf',
  'cursor',
  'zed',
  'vim',
  'neovim',
  'emacs',
  'hx',
  'micro'
] as const

const approvalModeItems = APPROVAL_MODE_OPTIONS.map((id) => ({ id }))
const editorItems = EDITOR_OPTIONS.map((id) => ({ id }))

export const GeminiConfigFields: FC<GeminiConfigFieldsProps> = ({ config, onChange }) => {
  const { t } = useTranslation()
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const general = useMemo(() => getRecord(config.general), [config.general])
  const ui = useMemo(() => getRecord(config.ui), [config.ui])
  const privacy = useMemo(() => getRecord(config.privacy), [config.privacy])
  const model = useMemo(() => getRecord(config.model), [config.model])
  const context = useMemo(() => getRecord(config.context), [config.context])
  const tools = useMemo(() => getRecord(config.tools), [config.tools])
  const advanced = useMemo(() => getRecord(config.advanced), [config.advanced])

  const updateSectionField = useCallback(
    (
      section: string,
      key: string,
      value: string | number | boolean | string[] | Record<string, unknown> | undefined
    ) => {
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

  const toggleBoolean = useCallback(
    (section: string, key: string, active: boolean, onValue: boolean, offValue?: boolean) => {
      updateSectionField(section, key, active ? offValue : onValue)
    },
    [updateSectionField]
  )

  const checkpointing = getRecord(general.checkpointing)
  const checkpointingEnabled = checkpointing.enabled === true
  const usageStatsDisabled = privacy.usageStatisticsEnabled === false

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

      <AdvancedConfigToggle open={advancedOpen} onToggle={() => setAdvancedOpen((o) => !o)}>
        <div className="flex gap-3">
          <Field label={t('code.adv.gemini.approval_mode_hint')}>
            <SelectDropdown
              items={approvalModeItems}
              selectedId={typeof general.defaultApprovalMode === 'string' ? general.defaultApprovalMode : undefined}
              onSelect={(v) => updateSectionField('general', 'defaultApprovalMode', v)}
              placeholder={t('code.adv.select_placeholder')}
              renderSelected={(item) => t(`code.adv.gemini.approval_${item.id}`)}
              renderItem={(item) => t(`code.adv.gemini.approval_${item.id}`)}
            />
          </Field>
          <Field label={t('code.adv.gemini.preferred_editor_hint')}>
            <SelectDropdown
              items={editorItems}
              selectedId={typeof general.preferredEditor === 'string' ? general.preferredEditor : undefined}
              onSelect={(v) => updateSectionField('general', 'preferredEditor', v)}
              placeholder={t('code.adv.select_placeholder')}
              renderSelected={(item) => item.id}
              renderItem={(item) => item.id}
            />
          </Field>
        </div>

        <div className="mt-3 flex gap-3">
          <Field label={t('code.adv.gemini.max_session_turns_hint')}>
            <Input
              value={typeof model.maxSessionTurns === 'number' ? String(model.maxSessionTurns) : ''}
              onChange={(e) => {
                const v = e.target.value
                updateSectionField('model', 'maxSessionTurns', v ? Number(v) : undefined)
              }}
              placeholder="-1"
              type="number"
              autoComplete="off"
              className="h-9 text-sm"
            />
          </Field>
          <Field label={t('code.adv.gemini.compression_threshold_hint')}>
            <Input
              value={typeof model.compressionThreshold === 'number' ? String(model.compressionThreshold) : ''}
              onChange={(e) => {
                const v = e.target.value
                updateSectionField('model', 'compressionThreshold', v ? Number(v) : undefined)
              }}
              placeholder="0.5"
              type="number"
              autoComplete="off"
              className="h-9 text-sm"
            />
          </Field>
        </div>

        <Field label={t('code.adv.gemini.context_files_hint')} className="mt-3 block w-full flex-none">
          <Input
            value={formatCommaList(context.fileName)}
            onChange={(e) => updateSectionField('context', 'fileName', parseCommaList(e.target.value))}
            placeholder="GEMINI.md, AGENTS.md"
            autoComplete="off"
            className="h-9 text-sm"
          />
        </Field>

        <Field label={t('code.adv.gemini.include_dirs_hint')} className="mt-3 block w-full flex-none">
          <Input
            value={formatCommaList(context.includeDirectories)}
            onChange={(e) => updateSectionField('context', 'includeDirectories', parseCommaList(e.target.value))}
            placeholder="../shared, ~/code/lib"
            autoComplete="off"
            className="h-9 text-sm"
          />
        </Field>

        <div className="mt-3 flex gap-3">
          <Field label={t('code.adv.gemini.exclude_tools_hint')}>
            <Input
              value={formatCommaList(tools.exclude)}
              onChange={(e) => updateSectionField('tools', 'exclude', parseCommaList(e.target.value))}
              placeholder="write_file, run_shell_command"
              autoComplete="off"
              className="h-9 text-sm"
            />
          </Field>
          <Field label={t('code.adv.gemini.excluded_env_vars_hint')}>
            <Input
              value={formatCommaList(advanced.excludedEnvVars)}
              onChange={(e) => updateSectionField('advanced', 'excludedEnvVars', parseCommaList(e.target.value))}
              placeholder="DEBUG, NODE_ENV"
              autoComplete="off"
              className="h-9 text-sm"
            />
          </Field>
        </div>
      </AdvancedConfigToggle>
    </div>
  )
}
