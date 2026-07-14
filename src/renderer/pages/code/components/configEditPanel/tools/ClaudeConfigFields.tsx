import { Button, Checkbox } from '@cherrystudio/ui'
import { ModelSelector } from '@renderer/components/ModelSelector'
import {
  CLAUDE_MODEL_ROLES,
  CLAUDE_PERMISSION_MODES,
  CLAUDE_REASONING_EFFORTS,
  safeCreateUniqueModelId,
  stripClaudeOneMMarker
} from '@renderer/pages/code/cliConfig'
import { isUniqueModelId, type Model, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { FC } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ModelSelectorTrigger } from '../ModelSelectorTrigger'
import { TogglePill } from '../TogglePill'
import { ConfigSelectField } from './ConfigFieldPrimitives'

const MODEL_ROLE_META = {
  fable: { labelKey: 'code.adv.claude.fable_model', supports1M: true },
  opus: { labelKey: 'code.adv.claude.opus_model', supports1M: true },
  sonnet: { labelKey: 'code.adv.claude.sonnet_model', supports1M: true },
  haiku: { labelKey: 'code.adv.claude.haiku_model', supports1M: false },
  subagent: { labelKey: 'code.adv.claude.subagent_model', supports1M: true }
} as const

const MODEL_ROLES = CLAUDE_MODEL_ROLES.map((role) => ({
  ...role,
  ...MODEL_ROLE_META[role.roleKey]
}))

const ONE_M_MARKER = '[1M]'

const BOOLEAN_TOGGLES = [
  { envKey: 'ENABLE_TOOL_SEARCH', labelKey: 'code.adv.claude.enable_tool_search', onValue: 'true' },
  { envKey: 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS', labelKey: 'code.adv.claude.enable_teammates', onValue: '1' },
  { envKey: 'DISABLE_AUTOUPDATER', labelKey: 'code.adv.claude.disable_auto_upgrade', onValue: '1' },
  {
    envKey: 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
    labelKey: 'code.adv.claude.disable_nonessential_traffic',
    onValue: '1'
  },
  {
    envKey: 'CLAUDE_CODE_DISABLE_BUNDLED_SKILLS',
    labelKey: 'code.adv.claude.disable_bundled_skills',
    onValue: '1'
  },
  { envKey: 'DISABLE_COMPACT', labelKey: 'code.adv.claude.disable_compact', onValue: '1' },
  {
    envKey: 'CLAUDE_CODE_DISABLE_1M_CONTEXT',
    labelKey: 'code.adv.claude.disable_1m_context',
    onValue: '1'
  },
  {
    envKey: 'CLAUDE_CODE_DISABLE_TERMINAL_TITLE',
    labelKey: 'code.adv.claude.disable_terminal_title',
    onValue: '1'
  },
  {
    envKey: 'DISABLE_EXTRA_USAGE_COMMAND',
    labelKey: 'code.adv.claude.disable_extra_usage_command',
    onValue: '1'
  },
  {
    envKey: 'CLAUDE_CODE_ATTRIBUTION_HEADER',
    labelKey: 'code.adv.claude.disable_attribution_header',
    onValue: '0'
  }
] as const

const DEFAULT_VISIBLE_TOGGLE_COUNT = 5

const PERMISSION_MODE_LABEL_KEYS: Record<(typeof CLAUDE_PERMISSION_MODES)[number], string> = {
  default: 'code.adv.permission_modes.default',
  acceptEdits: 'code.adv.permission_modes.accept_edits',
  plan: 'code.adv.permission_modes.plan',
  auto: 'code.adv.permission_modes.auto',
  bypassPermissions: 'code.adv.permission_modes.bypass_high_risk'
}

const REASONING_EFFORT_LABEL_KEYS: Record<(typeof CLAUDE_REASONING_EFFORTS)[number], string> = {
  low: 'code.adv.reasoning_efforts.low',
  medium: 'code.adv.reasoning_efforts.medium',
  high: 'code.adv.reasoning_efforts.high',
  xhigh: 'code.adv.reasoning_efforts.xhigh'
}

export interface ClaudeConfigFieldsProps {
  config: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  section?: 'all' | 'basic' | 'advanced'
  providerId?: string
  modelFilter?: (model: Model) => boolean
  onSettingsNavigate?: (navigate: () => void) => void
}

function getEnv(config: Record<string, unknown>): Record<string, string> {
  if (!config || typeof config.env !== 'object' || config.env === null) {
    return {}
  }
  return config.env as Record<string, string>
}

function getPermissions(config: Record<string, unknown>): Record<string, string> {
  if (!config || typeof config.permissions !== 'object' || config.permissions === null) {
    return {}
  }
  return config.permissions as Record<string, string>
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

function setOneMMarker(value: string, enabled: boolean): string {
  const base = stripClaudeOneMMarker(value).trim()
  return enabled ? `${base} ${ONE_M_MARKER}` : base
}

function getRawModelId(uniqueModelId: UniqueModelId | undefined): string {
  return uniqueModelId && isUniqueModelId(uniqueModelId) ? parseUniqueModelId(uniqueModelId).modelId : ''
}

function toProviderModelId(providerId: string | undefined, modelId: string): UniqueModelId | undefined {
  // modelId comes from a user-typed env value; never throw in a render path.
  return providerId && modelId ? safeCreateUniqueModelId(providerId, modelId) : undefined
}

export const ClaudeConfigFields: FC<ClaudeConfigFieldsProps> = ({
  config,
  onChange,
  section = 'all',
  providerId,
  modelFilter,
  onSettingsNavigate
}) => {
  const { t } = useTranslation()
  const [showAllToggles, setShowAllToggles] = useState(false)

  const env = useMemo(() => getEnv(config), [config])
  const permissions = useMemo(() => getPermissions(config), [config])
  const hideAttribution = useMemo(() => isAttributionHidden(config), [config])
  const visibleToggles = showAllToggles ? BOOLEAN_TOGGLES : BOOLEAN_TOGGLES.slice(0, DEFAULT_VISIBLE_TOGGLE_COUNT)
  const hiddenToggleCount = BOOLEAN_TOGGLES.length - DEFAULT_VISIBLE_TOGGLE_COUNT

  const updateEnvField = useCallback(
    (envKey: string, value: string) => {
      const nextEnv = { ...env }
      if (value) nextEnv[envKey] = value
      else delete nextEnv[envKey]
      onChange({ ...config, env: nextEnv })
    },
    [env, config, onChange]
  )

  const updateModelRole = useCallback(
    (role: (typeof CLAUDE_MODEL_ROLES)[number], modelValue: string) => {
      const { model } = role
      const nextEnv = { ...env }
      if (modelValue) {
        nextEnv[model] = modelValue
        if ('name' in role) nextEnv[role.name] = stripClaudeOneMMarker(modelValue)
      } else {
        delete nextEnv[model]
        if ('name' in role) delete nextEnv[role.name]
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

  const updateReasoningEffort = useCallback(
    (effortLevel: string | undefined) => {
      const next = { ...config }
      if (effortLevel) next.effortLevel = effortLevel
      else delete next.effortLevel
      onChange(next)
    },
    [config, onChange]
  )

  const updatePermissionMode = useCallback(
    (defaultMode: string | undefined) => {
      const next = { ...config }
      if (defaultMode) next.permissions = { defaultMode }
      else delete next.permissions
      onChange(next)
    },
    [config, onChange]
  )

  return (
    <div className="space-y-3">
      {section !== 'advanced' && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <ConfigSelectField
              label={t('code.adv.permission_mode')}
              className="max-w-none"
              value={permissions.defaultMode}
              placeholder={t('code.adv.select_placeholder')}
              options={CLAUDE_PERMISSION_MODES.map((mode) => ({
                value: mode,
                label: t(PERMISSION_MODE_LABEL_KEYS[mode])
              }))}
              onChange={updatePermissionMode}
            />
            <ConfigSelectField
              label={t('code.adv.reasoning_effort')}
              className="max-w-none"
              value={typeof config.effortLevel === 'string' ? config.effortLevel : undefined}
              placeholder={t('code.adv.select_placeholder')}
              unsetLabel={t('code.adv.reasoning_efforts.default')}
              options={CLAUDE_REASONING_EFFORTS.map((effort) => ({
                value: effort,
                label: t(REASONING_EFFORT_LABEL_KEYS[effort])
              }))}
              onChange={updateReasoningEffort}
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {visibleToggles.map((field) => {
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
            {showAllToggles && (
              <TogglePill
                label={t('code.adv.claude.hide_attribution')}
                active={hideAttribution}
                onClick={() => toggleHideAttribution(!hideAttribution)}
              />
            )}
            {hiddenToggleCount > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowAllToggles((expanded) => !expanded)}
                className="h-auto min-h-0 rounded-full border-border/50 px-2.5 py-1 text-[11px] text-muted-foreground/60 hover:border-border hover:text-foreground">
                {showAllToggles ? t('code.collapse') : t('code.more')}
              </Button>
            )}
          </div>
        </>
      )}

      {section !== 'basic' && (
        <div className="space-y-2">
          {MODEL_ROLES.map((field) => {
            const envKey = field.model
            const rawValue = env[envKey] ?? ''
            const roleModelId = stripClaudeOneMMarker(rawValue).trim()
            const uses1M = hasOneMMarker(rawValue)
            return (
              <div key={field.roleKey} className="flex items-center gap-2">
                <span className="w-14 shrink-0 text-foreground text-sm">{t(field.labelKey)}</span>
                <ClaudeRoleModelSelector
                  value={toProviderModelId(providerId, roleModelId)}
                  placeholder={t('settings.models.empty')}
                  filter={modelFilter}
                  onSettingsNavigate={onSettingsNavigate}
                  onSelect={(nextModelId) => {
                    const nextRawModelId = getRawModelId(nextModelId)
                    updateModelRole(field, nextRawModelId ? setOneMMarker(nextRawModelId, uses1M) : '')
                  }}
                />
                <div className="flex w-16 shrink-0 justify-end">
                  {field.supports1M && roleModelId && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-muted-foreground/55">1M</span>
                      <Checkbox
                        size="sm"
                        aria-label="1M"
                        checked={uses1M}
                        onCheckedChange={(checked) =>
                          updateModelRole(field, roleModelId ? setOneMMarker(roleModelId, checked === true) : '')
                        }
                      />
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const ClaudeRoleModelSelector: FC<{
  value?: UniqueModelId
  placeholder: string
  filter?: (model: Model) => boolean
  onSettingsNavigate?: (navigate: () => void) => void
  onSelect: (modelId: UniqueModelId | undefined) => void
}> = ({ value, placeholder, filter, onSettingsNavigate, onSelect }) => {
  return (
    <div className="min-w-0 flex-1">
      <ModelSelector
        multiple={false}
        selectionType="id"
        value={value}
        onSelect={onSelect}
        filter={filter}
        showTagFilter
        onSettingsNavigate={onSettingsNavigate}
        trigger={<ModelSelectorTrigger value={value} placeholder={placeholder} />}
      />
    </div>
  )
}
