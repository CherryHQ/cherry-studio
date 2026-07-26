import { CODEX_PERMISSION_MODES, CODEX_REASONING_EFFORTS } from '@renderer/pages/code/cliConfig'
import type { FC } from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { TogglePill } from '../TogglePill'
import { ConfigSelectField } from './ConfigFieldPrimitives'
import { makeUpdateField } from './configFieldUtils'

export interface CodexConfigFieldsProps {
  config: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  section?: 'all' | 'basic' | 'advanced'
}

type CodexFlag = 'goalMode' | 'remoteCompaction' | 'disableResponseStorage'

const PERMISSION_MODE_LABEL_KEYS: Record<(typeof CODEX_PERMISSION_MODES)[number], string> = {
  readOnly: 'code.adv.permission_modes.read_only',
  workspace: 'code.adv.permission_modes.workspace',
  fullAccess: 'code.adv.permission_modes.full_access_high_risk'
}

const REASONING_EFFORT_LABEL_KEYS: Record<(typeof CODEX_REASONING_EFFORTS)[number], string> = {
  minimal: 'code.adv.reasoning_efforts.minimal',
  low: 'code.adv.reasoning_efforts.low',
  medium: 'code.adv.reasoning_efforts.medium',
  high: 'code.adv.reasoning_efforts.high',
  xhigh: 'code.adv.reasoning_efforts.xhigh'
}

export const CodexConfigFields: FC<CodexConfigFieldsProps> = ({ config, onChange, section = 'all' }) => {
  const { t } = useTranslation()
  const updateField = useMemo(() => makeUpdateField(config, onChange), [config, onChange])

  const goalMode = config.goalMode === true
  const remoteCompaction = config.remoteCompaction === true
  const disableResponseStorage = config.disableResponseStorage === true

  const toggle = useCallback(
    (key: CodexFlag, value: boolean) => {
      const next = { ...config }
      if (value) next[key] = true
      else delete next[key]
      onChange(next)
    },
    [config, onChange]
  )

  if (section === 'advanced') return null

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <ConfigSelectField
          label={t('code.adv.permission_mode')}
          className="max-w-none"
          value={typeof config.permissionMode === 'string' ? config.permissionMode : undefined}
          placeholder={t('code.adv.select_placeholder')}
          options={CODEX_PERMISSION_MODES.map((mode) => ({
            value: mode,
            label: t(PERMISSION_MODE_LABEL_KEYS[mode])
          }))}
          onChange={(value) => updateField('permissionMode', value)}
        />
        <ConfigSelectField
          label={t('code.adv.reasoning_effort')}
          className="max-w-none"
          value={typeof config.reasoningEffort === 'string' ? config.reasoningEffort : undefined}
          placeholder={t('code.adv.select_placeholder')}
          unsetLabel={t('code.adv.reasoning_efforts.default')}
          options={CODEX_REASONING_EFFORTS.map((effort) => ({
            value: effort,
            label: t(REASONING_EFFORT_LABEL_KEYS[effort])
          }))}
          onChange={(value) => updateField('reasoningEffort', value)}
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <TogglePill
          label={t('code.adv.codex.goal_mode')}
          active={goalMode}
          onClick={() => toggle('goalMode', !goalMode)}
        />
        <TogglePill
          label={t('code.adv.codex.remote_compaction')}
          active={remoteCompaction}
          onClick={() => toggle('remoteCompaction', !remoteCompaction)}
        />
        <TogglePill
          label={t('code.adv.codex.disable_response_storage')}
          active={disableResponseStorage}
          onClick={() => toggle('disableResponseStorage', !disableResponseStorage)}
        />
      </div>
    </div>
  )
}
