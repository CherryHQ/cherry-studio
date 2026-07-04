import { Checkbox } from '@cherrystudio/ui'
import { ModelSelector } from '@renderer/components/Selector/model'
import { isUniqueModelId, type Model, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { FC } from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { ModelSelectorTrigger } from '../ModelSelectorTrigger'
import { TogglePill } from '../TogglePill'

const MODEL_ROLES = [
  { roleKey: 'fable', labelKey: 'code.adv.claude.fable_model', supports1M: true },
  { roleKey: 'opus', labelKey: 'code.adv.claude.opus_model', supports1M: true },
  { roleKey: 'sonnet', labelKey: 'code.adv.claude.sonnet_model', supports1M: true },
  { roleKey: 'haiku', labelKey: 'code.adv.claude.haiku_model', supports1M: false }
] as const

const ROLE_ENV: Record<string, { model: string; name: string }> = {
  sonnet: { model: 'ANTHROPIC_DEFAULT_SONNET_MODEL', name: 'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME' },
  opus: { model: 'ANTHROPIC_DEFAULT_OPUS_MODEL', name: 'ANTHROPIC_DEFAULT_OPUS_MODEL_NAME' },
  fable: { model: 'ANTHROPIC_DEFAULT_FABLE_MODEL', name: 'ANTHROPIC_DEFAULT_FABLE_MODEL_NAME' },
  haiku: { model: 'ANTHROPIC_DEFAULT_HAIKU_MODEL', name: 'ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME' }
}

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

export interface ClaudeConfigFieldsProps {
  config: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  section?: 'all' | 'basic' | 'advanced'
  providerId?: string
  currentModelId?: UniqueModelId
  modelFilter?: (model: Model) => boolean
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

function getRawModelId(uniqueModelId: UniqueModelId | undefined): string {
  return uniqueModelId && isUniqueModelId(uniqueModelId) ? parseUniqueModelId(uniqueModelId).modelId : ''
}

function toProviderModelId(providerId: string | undefined, modelId: string): UniqueModelId | undefined {
  return providerId && modelId ? `${providerId}::${modelId}` : undefined
}

export const ClaudeConfigFields: FC<ClaudeConfigFieldsProps> = ({
  config,
  onChange,
  section = 'all',
  providerId,
  currentModelId,
  modelFilter
}) => {
  const { t } = useTranslation()

  const env = useMemo(() => getEnv(config), [config])
  const hideAttribution = useMemo(() => isAttributionHidden(config), [config])

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
    (roleKey: string, modelValue: string) => {
      const { model, name } = ROLE_ENV[roleKey]
      const nextEnv = { ...env }
      if (modelValue) {
        nextEnv[model] = modelValue
        nextEnv[name] = stripOneMMarker(modelValue)
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
    <div className="space-y-3">
      {section !== 'advanced' && (
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
      )}

      {section !== 'basic' && (
        <div className="space-y-2">
          {MODEL_ROLES.map((field) => {
            const envKey = ROLE_ENV[field.roleKey].model
            const rawValue = env[envKey] ?? ''
            const roleModelId = stripOneMMarker(rawValue).trim()
            const defaultModelId = getRawModelId(currentModelId)
            const displayedModelId = roleModelId || defaultModelId
            const uses1M = hasOneMMarker(rawValue)
            return (
              <div key={field.roleKey} className="flex items-center gap-2">
                <span className="w-14 shrink-0 text-foreground text-xs">{t(field.labelKey)}</span>
                <ClaudeRoleModelSelector
                  value={toProviderModelId(providerId, displayedModelId)}
                  placeholder={t('settings.models.empty')}
                  filter={modelFilter}
                  onSelect={(nextModelId) => {
                    const nextRawModelId = getRawModelId(nextModelId)
                    const nextOverride = nextRawModelId && nextRawModelId !== defaultModelId ? nextRawModelId : ''
                    updateModelRole(field.roleKey, nextOverride ? setOneMMarker(nextOverride, uses1M) : '')
                  }}
                />
                <div className="flex w-16 shrink-0 justify-end">
                  {field.supports1M && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-muted-foreground/55">1M</span>
                      <Checkbox
                        size="sm"
                        aria-label="1M"
                        checked={uses1M}
                        onCheckedChange={(checked) =>
                          updateModelRole(
                            field.roleKey,
                            displayedModelId ? setOneMMarker(displayedModelId, checked === true) : ''
                          )
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
  onSelect: (modelId: UniqueModelId | undefined) => void
}> = ({ value, placeholder, filter, onSelect }) => {
  return (
    <div className="min-w-0 flex-1">
      <ModelSelector
        multiple={false}
        selectionType="id"
        value={value}
        onSelect={onSelect}
        filter={filter}
        showTagFilter
        trigger={<ModelSelectorTrigger value={value} placeholder={placeholder} />}
      />
    </div>
  )
}
