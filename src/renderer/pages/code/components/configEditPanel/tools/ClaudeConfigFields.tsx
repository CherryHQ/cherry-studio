import { Input, Popover, PopoverContent, PopoverTrigger, Switch } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import { ChevronDown } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AdvancedConfigToggle } from '../AdvancedConfigToggle'
import { TogglePill } from '../TogglePill'

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

function getPermissions(config: Record<string, unknown>): { allow: string[]; deny: string[] } {
  if (!config || typeof config.permissions !== 'object' || config.permissions === null) {
    return { allow: [], deny: [] }
  }
  const perms = config.permissions as { allow?: unknown; deny?: unknown }
  return {
    allow: Array.isArray(perms.allow) ? perms.allow.filter((v: unknown) => typeof v === 'string') : [],
    deny: Array.isArray(perms.deny) ? perms.deny.filter((v: unknown) => typeof v === 'string') : []
  }
}

function parsePatternList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function formatPatternList(list: string[]): string {
  return list.join(', ')
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

function ClaudeEffortPopover({
  value,
  placeholder,
  onChange
}: {
  value: string
  placeholder: string
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-9 w-full min-w-0 items-center justify-between rounded-md border bg-transparent px-3 text-sm outline-none',
            'border-input focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
            'font-normal hover:bg-muted/30 transition-colors',
            'data-[state=open]:border-ring data-[state=open]:ring-ring/50 data-[state=open]:ring-[3px]'
          )}>
          <span className={cn('truncate', !value && 'text-muted-foreground')}>{value || placeholder}</span>
          <ChevronDown className="ml-1 size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="p-1"
        style={{ width: 'var(--radix-popover-trigger-width)' }}
        align="start"
        side="bottom"
        sideOffset={4}>
        {(['auto', 'low', 'medium', 'high', 'xhigh', 'max', 'ultracode'] as const).map((opt) => (
          <button
            key={opt}
            type="button"
            className={cn(
              'w-full cursor-pointer rounded-sm px-2 py-1.5 text-sm text-left transition-colors',
              'hover:bg-accent hover:text-accent-foreground',
              value === opt && 'bg-primary/10 text-primary'
            )}
            onClick={() => {
              onChange(opt)
              setOpen(false)
            }}>
            {opt}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

export const ClaudeConfigFields: FC<ClaudeConfigFieldsProps> = ({ config, onChange }) => {
  const { t } = useTranslation()

  const env = useMemo(() => getEnv(config), [config])
  const hideAttribution = useMemo(() => isAttributionHidden(config), [config])
  const permissions = useMemo(() => getPermissions(config), [config])

  const [advancedOpen, setAdvancedOpen] = useState(false)

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
    (roleKey: string, modelValue: string, displayName?: string) => {
      const { model, name } = ROLE_ENV[roleKey]
      const nextEnv = { ...env }
      if (modelValue) {
        nextEnv[model] = modelValue
        nextEnv[name] = displayName ?? stripOneMMarker(modelValue)
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

  const updatePermissions = useCallback(
    (field: 'allow' | 'deny', raw: string) => {
      const patterns = parsePatternList(raw)
      const nextPermissions = { ...permissions }
      if (patterns.length > 0) nextPermissions[field] = patterns
      else delete nextPermissions[field]
      const { permissions: _, ...rest } = config
      if (Object.keys(nextPermissions).length > 0) onChange({ ...rest, permissions: nextPermissions })
      else onChange(rest)
    },
    [config, permissions, onChange]
  )

  return (
    <div className="space-y-3">
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
        <span className="mb-2 block text-[10px] text-muted-foreground/60">{t('code.adv.claude.model_roles_hint')}</span>
        <div className="overflow-hidden rounded-lg border border-border/40">
          <div className="flex items-center gap-2 bg-accent/20 px-3 py-1.5 text-[10px] text-muted-foreground/55">
            <span className="w-14 shrink-0">{t('code.adv.claude.role_column')}</span>
            <span className="min-w-0 flex-1">{t('code.adv.claude.model_column')}</span>
            <span className="w-9 shrink-0 text-center">{t('code.adv.claude.context_column')}</span>
          </div>
          {MODEL_ROLES.map((field, i) => {
            const envKey = ROLE_ENV[field.roleKey].model
            const rawValue = env[envKey] ?? ''
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
                  className="h-9 text-sm"
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

        <div className="mt-3 flex gap-3">
          <label className="min-w-0 flex-1">
            <span className="mb-1 block text-[10px] text-muted-foreground/60">
              {t('code.adv.claude.max_output_tokens_hint')}
            </span>
            <Input
              value={env['CLAUDE_CODE_MAX_OUTPUT_TOKENS'] ?? ''}
              onChange={(e) => updateEnvField('CLAUDE_CODE_MAX_OUTPUT_TOKENS', e.target.value)}
              placeholder="131072"
              autoComplete="off"
              className="h-9 text-sm"
            />
          </label>
          <label className="min-w-0 flex-1">
            <span className="mb-1 block text-[10px] text-muted-foreground/60">
              {t('code.adv.claude.effort_level_hint')}
            </span>
            <ClaudeEffortPopover
              value={env['CLAUDE_CODE_EFFORT_LEVEL'] ?? ''}
              placeholder={t('code.adv.select_placeholder')}
              onChange={(v) => updateEnvField('CLAUDE_CODE_EFFORT_LEVEL', v)}
            />
          </label>
        </div>

        <label className="mt-3 block">
          <span className="mb-1 block text-[10px] text-muted-foreground/60">
            {t('code.adv.claude.max_context_tokens_hint')}
          </span>
          <Input
            value={env['CLAUDE_CODE_MAX_CONTEXT_TOKENS'] ?? ''}
            onChange={(e) => updateEnvField('CLAUDE_CODE_MAX_CONTEXT_TOKENS', e.target.value)}
            placeholder="200000"
            autoComplete="off"
            className="h-9 text-sm"
          />
        </label>

        <span className="mt-3 mb-1 block text-[10px] text-muted-foreground/60">
          {t('code.adv.claude.permissions_hint')}
        </span>
        <div className="space-y-2">
          <div>
            <span className="mb-1 block text-[10px] text-muted-foreground/55">
              {t('code.adv.claude.permissions_allow')}
            </span>
            <Input
              value={formatPatternList(permissions.allow)}
              onChange={(e) => updatePermissions('allow', e.target.value)}
              placeholder="Bash, Read, Write, Edit"
              autoComplete="off"
              className="h-9 text-sm"
            />
          </div>
          <div>
            <span className="mb-1 block text-[10px] text-muted-foreground/55">
              {t('code.adv.claude.permissions_deny')}
            </span>
            <Input
              value={formatPatternList(permissions.deny)}
              onChange={(e) => updatePermissions('deny', e.target.value)}
              placeholder="WebSearch, WebFetch, Read(secrets-*/config.json)"
              autoComplete="off"
              className="h-9 text-sm"
            />
          </div>
        </div>
      </AdvancedConfigToggle>
    </div>
  )
}
