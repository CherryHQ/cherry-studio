import { Input, Switch } from '@cherrystudio/ui'
import { SettingHelpText } from '@renderer/pages/settings'
import type { FC } from 'react'
import type { ReactNode } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AdvancedConfigToggle } from '../AdvancedConfigToggle'
import { TogglePill } from '../TogglePill'

/** Each role writes BOTH the request model and its display name. */
const MODEL_ROLES = [
  { roleKey: 'sonnet', labelKey: 'code.adv.claude.sonnet_model', placeholder: 'claude-sonnet-4-5', supports1M: true },
  { roleKey: 'opus', labelKey: 'code.adv.claude.opus_model', placeholder: 'claude-opus-4-1', supports1M: true },
  { roleKey: 'fable', labelKey: 'code.adv.claude.fable_model', placeholder: 'claude-fable-1', supports1M: true },
  { roleKey: 'haiku', labelKey: 'code.adv.claude.haiku_model', placeholder: 'claude-haiku-4-5', supports1M: false }
] as const

const ROLE_ENV: Record<string, { model: string; name: string }> = {
  sonnet: { model: 'ANTHROPIC_DEFAULT_SONNET_MODEL', name: 'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME' },
  opus: { model: 'ANTHROPIC_DEFAULT_OPUS_MODEL', name: 'ANTHROPIC_DEFAULT_OPUS_MODEL_NAME' },
  fable: { model: 'ANTHROPIC_DEFAULT_FABLE_MODEL', name: 'ANTHROPIC_DEFAULT_FABLE_MODEL_NAME' },
  haiku: { model: 'ANTHROPIC_DEFAULT_HAIKU_MODEL', name: 'ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME' }
}

const ONE_M_MARKER = '[1M]'

/** Boolean env toggles. `onValue` is the exact string written to env. */
const BOOLEAN_TOGGLES = [
  { envKey: 'ENABLE_TOOL_SEARCH', labelKey: 'code.adv.claude.enable_tool_search', onValue: 'true' },
  { envKey: 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS', labelKey: 'code.adv.claude.enable_teammates', onValue: '1' },
  { envKey: 'CLAUDE_CODE_EFFORT_LEVEL', labelKey: 'code.adv.claude.effort_max', onValue: 'max' },
  { envKey: 'DISABLE_AUTOUPDATER', labelKey: 'code.adv.claude.disable_auto_upgrade', onValue: '1' }
] as const

export interface ClaudeConfigFieldsProps {
  config: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  children?: ReactNode
}

function getEnv(config: Record<string, unknown>): Record<string, string> {
  if (!config || typeof config.env !== 'object' || config.env === null) {
    return {}
  }
  return config.env as Record<string, string>
}

function isAttributionHidden(config: Record<string, unknown>): boolean {
  if (!config || typeof config.attribution !== 'object' || config.attribution === null) {
    return false
  }
  const attr = config.attribution as { commit: string; pr: string }
  return attr.commit === '' && attr.pr === ''
}

function hasOneMMarker(value: string): boolean {
  return value.trimEnd().toLowerCase().endsWith(ONE_M_MARKER.toLowerCase())
}

function stripOneMMarker(value: string): string {
  const trimmed = value.trimEnd()
  if (trimmed.toLowerCase().endsWith(ONE_M_MARKER.toLowerCase())) {
    return trimmed.slice(0, -ONE_M_MARKER.length).trimEnd()
  }
  return value
}

function setOneMMarker(value: string, enabled: boolean): string {
  const base = stripOneMMarker(value).trim()
  return enabled ? `${base} ${ONE_M_MARKER}` : base
}

/** Self-contained Claude Code configuration fields. */
export const ClaudeConfigFields: FC<ClaudeConfigFieldsProps> = ({ config, onChange, children }) => {
  const { t } = useTranslation()

  const env = useMemo(() => getEnv(config), [config])
  const hideAttribution = useMemo(() => isAttributionHidden(config), [config])

  const [advancedOpen, setAdvancedOpen] = useState(false)

  const updateEnvField = useCallback(
    (envKey: string, value: string) => {
      const nextEnv = { ...env }
      if (value) {
        nextEnv[envKey] = value
      } else {
        delete nextEnv[envKey]
      }
      onChange({ ...config, env: nextEnv })
    },
    [env, config, onChange]
  )

  /** Set a model role: writes both _MODEL and _MODEL_NAME. */
  const updateModelRole = useCallback(
    (roleKey: string, value: string) => {
      const { model, name } = ROLE_ENV[roleKey]
      const nextEnv = { ...env }
      if (value) {
        nextEnv[model] = value
        nextEnv[name] = value
      } else {
        delete nextEnv[model]
        delete nextEnv[name]
      }
      onChange({ ...config, env: nextEnv })
    },
    [env, config, onChange]
  )

  const toggleHideAttribution = useCallback(
    (hide: boolean) => {
      const { ...rest } = config
      delete rest.attribution
      onChange(hide ? { ...rest, attribution: { commit: '', pr: '' } } : rest)
    },
    [config, onChange]
  )

  return (
    <div className="space-y-4">
      {/* Quick options — rendered directly under the Tool Parameters group title */}
      <div className="flex flex-wrap gap-1.5">
        {BOOLEAN_TOGGLES.map((field) => {
          const active = env[field.envKey] === field.onValue
          return (
            <TogglePill
              key={field.envKey}
              label={t(field.labelKey)}
              active={active}
              onClick={() => updateEnvField(field.envKey, active ? '' : field.onValue)}
            />
          )
        })}
        <TogglePill
          label={t('code.adv.claude.hide_attribution')}
          active={hideAttribution}
          onClick={() => toggleHideAttribution(!hideAttribution)}
        />
      </div>

      <AdvancedConfigToggle open={advancedOpen} onToggle={() => setAdvancedOpen((o) => !o)}>
        {children}
        {/* Model role mapping (role | model | 1M) */}
        <SettingHelpText className="mb-2">{t('code.adv.claude.model_roles_hint')}</SettingHelpText>
        <div className="overflow-hidden rounded-lg border border-border/40">
          <div className="flex items-center gap-2 bg-accent/20 px-3 py-1.5 text-[10px] text-muted-foreground/55">
            <span className="w-14 shrink-0">{t('code.adv.claude.role_column')}</span>
            <span className="min-w-0 flex-1">{t('code.adv.claude.model_column')}</span>
            <span className="w-9 shrink-0 text-center">{t('code.adv.claude.context_column')}</span>
          </div>
          {MODEL_ROLES.map((field, i) => {
            const model = ROLE_ENV[field.roleKey].model
            const rawValue = env[model] ?? ''
            const base = stripOneMMarker(rawValue)
            const uses1M = hasOneMMarker(rawValue)
            return (
              <div
                key={field.roleKey}
                className={`flex items-center gap-2 px-3 py-2 ${i > 0 ? 'border-border/20 border-t' : ''}`}>
                <span className="w-14 shrink-0 text-foreground text-xs">{t(field.labelKey)}</span>
                <Input
                  value={base}
                  onChange={(e) => updateModelRole(field.roleKey, setOneMMarker(e.target.value, uses1M))}
                  placeholder={field.placeholder}
                  autoComplete="off"
                  className="font-mono"
                />
                <div className="flex w-9 shrink-0 justify-center">
                  {field.supports1M && (
                    <Switch
                      checked={uses1M}
                      onCheckedChange={(checked) =>
                        updateModelRole(field.roleKey, setOneMMarker(base, checked === true))
                      }
                    />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </AdvancedConfigToggle>
    </div>
  )
}
