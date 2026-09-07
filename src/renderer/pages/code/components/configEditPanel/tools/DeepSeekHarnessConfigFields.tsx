import {
  DEEPSEEK_HARNESS_AGENT_PRESETS,
  DEEPSEEK_HARNESS_PERMISSION_MODES,
  type DeepSeekHarnessAgentPreset,
  type DeepSeekHarnessPermissionMode,
  isDeepSeekHarnessAgentPreset,
  isDeepSeekHarnessPermissionMode,
  normalizeDeepSeekHarnessSettings
} from '@shared/types/codeCli'
import { AlertTriangle } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfigSelectField } from './ConfigFieldPrimitives'

interface DeepSeekHarnessConfigFieldsProps {
  config: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  section?: 'all' | 'basic' | 'advanced'
}

const AGENT_PRESET_LABEL_KEYS: Record<DeepSeekHarnessAgentPreset, string> = {
  inherit: 'code.deepseek_harness.agent_presets.inherit.label',
  standard: 'code.deepseek_harness.agent_presets.standard.label',
  code: 'code.deepseek_harness.agent_presets.code.label',
  minimal: 'code.deepseek_harness.agent_presets.minimal.label'
}

const AGENT_PRESET_DESCRIPTION_KEYS: Record<DeepSeekHarnessAgentPreset, string> = {
  inherit: 'code.deepseek_harness.agent_presets.inherit.description',
  standard: 'code.deepseek_harness.agent_presets.standard.description',
  code: 'code.deepseek_harness.agent_presets.code.description',
  minimal: 'code.deepseek_harness.agent_presets.minimal.description'
}

const PERMISSION_MODE_LABEL_KEYS: Record<DeepSeekHarnessPermissionMode, string> = {
  'read-only': 'code.deepseek_harness.permission_modes.read-only.label',
  'workspace-write': 'code.deepseek_harness.permission_modes.workspace-write.label',
  'danger-full-access': 'code.deepseek_harness.permission_modes.danger-full-access.label'
}

const PERMISSION_MODE_DESCRIPTION_KEYS: Record<DeepSeekHarnessPermissionMode, string> = {
  'read-only': 'code.deepseek_harness.permission_modes.read-only.description',
  'workspace-write': 'code.deepseek_harness.permission_modes.workspace-write.description',
  'danger-full-access': 'code.deepseek_harness.permission_modes.danger-full-access.description'
}

export const DeepSeekHarnessConfigFields: FC<DeepSeekHarnessConfigFieldsProps> = ({
  config,
  onChange,
  section = 'all'
}) => {
  const { t } = useTranslation()
  const settings = normalizeDeepSeekHarnessSettings(config)

  if (section === 'advanced') return null

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <ConfigSelectField
            label={t('code.deepseek_harness.agent_preset')}
            className="max-w-none"
            value={settings.agentPreset}
            options={DEEPSEEK_HARNESS_AGENT_PRESETS.map((preset) => ({
              value: preset,
              label: t(AGENT_PRESET_LABEL_KEYS[preset])
            }))}
            onChange={(agentPreset) => {
              if (isDeepSeekHarnessAgentPreset(agentPreset)) onChange({ ...settings, agentPreset })
            }}
          />
          <p className="mt-1 text-foreground-tertiary text-xs">
            {t(AGENT_PRESET_DESCRIPTION_KEYS[settings.agentPreset])}
          </p>
        </div>
        <div>
          <ConfigSelectField
            label={t('code.deepseek_harness.permission_mode')}
            className="max-w-none"
            value={settings.permissionMode}
            options={DEEPSEEK_HARNESS_PERMISSION_MODES.map((mode) => ({
              value: mode,
              label: t(PERMISSION_MODE_LABEL_KEYS[mode])
            }))}
            onChange={(permissionMode) => {
              if (isDeepSeekHarnessPermissionMode(permissionMode)) onChange({ ...settings, permissionMode })
            }}
          />
          <p className="mt-1 text-foreground-tertiary text-xs">
            {t(PERMISSION_MODE_DESCRIPTION_KEYS[settings.permissionMode])}
          </p>
        </div>
      </div>

      {settings.permissionMode === 'danger-full-access' && (
        <div
          role="alert"
          className="flex gap-2 rounded-lg border border-warning-border bg-warning-subtle px-3 py-2 text-warning-subtle-foreground text-xs">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{t('code.deepseek_harness.danger_warning')}</span>
        </div>
      )}
    </div>
  )
}
