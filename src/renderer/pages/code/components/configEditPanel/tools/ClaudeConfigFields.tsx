import { Button, CodeEditor, Input } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { parseJSON } from '@renderer/utils/json'
import { Wand2 } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AdvancedConfigToggle } from '../AdvancedConfigToggle'
import { FormField, Section } from '../PanelPrimitives'
import { TogglePill } from '../TogglePill'

/** Each role writes BOTH the request model and its display name. */
const MODEL_ROLES = [
  { roleKey: 'sonnet', labelKey: 'code.adv.claude.sonnet_model', placeholder: 'claude-sonnet-4-5' },
  { roleKey: 'opus', labelKey: 'code.adv.claude.opus_model', placeholder: 'claude-opus-4-1' },
  { roleKey: 'fable', labelKey: 'code.adv.claude.fable_model', placeholder: 'claude-fable-1' },
  { roleKey: 'haiku', labelKey: 'code.adv.claude.haiku_model', placeholder: 'claude-haiku-4-5' }
] as const

const ROLE_ENV: Record<string, { model: string; name: string }> = {
  sonnet: { model: 'ANTHROPIC_DEFAULT_SONNET_MODEL', name: 'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME' },
  opus: { model: 'ANTHROPIC_DEFAULT_OPUS_MODEL', name: 'ANTHROPIC_DEFAULT_OPUS_MODEL_NAME' },
  fable: { model: 'ANTHROPIC_DEFAULT_FABLE_MODEL', name: 'ANTHROPIC_DEFAULT_FABLE_MODEL_NAME' },
  haiku: { model: 'ANTHROPIC_DEFAULT_HAIKU_MODEL', name: 'ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME' }
}

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

function toJson(value: unknown): string | null {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return null
  }
}

/** Self-contained Claude Code configuration fields. */
export const ClaudeConfigFields: FC<ClaudeConfigFieldsProps> = ({ config, onChange }) => {
  const { t } = useTranslation()
  const { activeCmTheme } = useCodeStyle()
  const [fontSize] = usePreference('chat.message.font_size')

  const env = useMemo(() => getEnv(config), [config])
  const hideAttribution = useMemo(() => isAttributionHidden(config), [config])

  // Raw JSON editor buffer. It mirrors `config` but is only overwritten when
  // `config` changes from OUTSIDE the editor (structured fields or a config
  // switch). We detect that by comparing the serialized form recorded at the
  // last commit — so the editor is never clobbered mid-typing, and the config
  // section is never collapsed by an in-panel edit.
  const [configText, setConfigText] = useState(() => toJson(config) ?? '{}')
  const syncedSerialized = useRef(toJson(config) ?? '{}')
  const [advancedOpen, setAdvancedOpen] = useState(false)

  useEffect(() => {
    const serialized = toJson(config) ?? '{}'
    if (serialized !== syncedSerialized.current) {
      syncedSerialized.current = serialized
      setConfigText(serialized)
    }
  }, [config])

  const commit = useCallback(
    (next: Record<string, unknown>) => {
      syncedSerialized.current = toJson(next) ?? '{}'
      onChange(next)
    },
    [onChange]
  )

  const updateEnvField = useCallback(
    (envKey: string, value: string) => {
      const nextEnv = { ...env }
      if (value) {
        nextEnv[envKey] = value
      } else {
        delete nextEnv[envKey]
      }
      const next = { ...config, env: nextEnv }
      setConfigText(toJson(next) ?? '{}')
      commit(next)
    },
    [env, config, commit]
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
      const next = { ...config, env: nextEnv }
      setConfigText(toJson(next) ?? '{}')
      commit(next)
    },
    [env, config, commit]
  )

  const toggleHideAttribution = useCallback(
    (hide: boolean) => {
      const { ...rest } = config
      delete rest.attribution
      const next = hide ? { ...rest, attribution: { commit: '', pr: '' } } : rest
      setConfigText(toJson(next) ?? '{}')
      commit(next)
    },
    [config, commit]
  )

  const handleConfigTextChange = useCallback(
    (next: string) => {
      setConfigText(next)
      const parsed = parseJSON(next)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        commit(parsed as Record<string, unknown>)
      }
    },
    [commit]
  )

  const handleFormat = useCallback(() => {
    setConfigText((prev) => {
      const formatted = toJson(parseJSON(prev)) ?? prev
      const parsed = parseJSON(formatted)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        commit(parsed as Record<string, unknown>)
      }
      return formatted
    })
  }, [commit])

  return (
    <div className="space-y-4">
      {/* Quick options — grouped so the pills read as a deliberate toolbar. */}
      <div className="rounded-lg border border-border/40 bg-muted/20 p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">{t('code.adv.claude.options')}</div>
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
      </div>

      <AdvancedConfigToggle open={advancedOpen} onToggle={() => setAdvancedOpen((o) => !o)}>
        {/* Model role mapping — responsive grid (label-above-input cells). */}
        <div className="space-y-2.5">
          <div className="flex items-baseline gap-2">
            <span className="font-medium text-foreground/80 text-xs">{t('code.adv.claude.model_roles')}</span>
            <span className="text-[11px] text-muted-foreground/50">{t('code.adv.claude.model_roles_hint')}</span>
          </div>
          <div className="grid grid-cols-1 items-start gap-x-4 gap-y-4 xl:grid-cols-3">
            {MODEL_ROLES.map((field) => (
              <FormField key={field.roleKey} label={t(field.labelKey)}>
                <Input
                  value={env[ROLE_ENV[field.roleKey].model] ?? ''}
                  onChange={(e) => updateModelRole(field.roleKey, e.target.value)}
                  placeholder={field.placeholder}
                  autoComplete="off"
                  className="font-mono"
                />
              </FormField>
            ))}
          </div>
        </div>
      </AdvancedConfigToggle>

      {/* Raw JSON config */}
      <Section
        title={t('code.raw_config')}
        description={t('code.config_json_hint')}
        action={
          <Button
            variant="ghost"
            size="sm"
            onClick={handleFormat}
            className="gap-1 px-2 py-0.5 text-[11px] text-muted-foreground/70 hover:text-foreground">
            <Wand2 size={11} />
            {t('code.format_json')}
          </Button>
        }>
        <CodeEditor
          theme={activeCmTheme}
          fontSize={fontSize - 4}
          value={configText}
          language="json"
          onChange={handleConfigTextChange}
          height="200px"
          expanded={false}
          wrapped
          className="overflow-hidden rounded-md border border-border/40"
          options={{ lint: true, lineNumbers: true, foldGutter: true, keymap: true }}
        />
      </Section>
    </div>
  )
}
