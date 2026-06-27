import { CodeEditor } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import type { FC } from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { Section } from '../PanelPrimitives'

export interface CodexConfigFieldsProps {
  /** The config body (source of truth, owned by the panel). */
  config: Record<string, unknown>
  /** Replace the config body entirely. */
  onChange: (next: Record<string, unknown>) => void
}

const DEFAULT_AUTH = `{
  "OPENAI_API_KEY": null
}`
const DEFAULT_TOML = `model = "gpt-5"
model_provider = "Cherry"`

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

/** Codex splits its provider config across two files — `~/.codex/auth.json`
 * (credentials) and `~/.codex/config.toml` (model + provider wiring) — so this
 * editor exposes both as raw editors. The two text blobs
 * live on the config body under `authJson` / `configToml`. */
export const CodexConfigFields: FC<CodexConfigFieldsProps> = ({ config, onChange }) => {
  const { t } = useTranslation()
  const { activeCmTheme } = useCodeStyle()
  const [fontSize] = usePreference('chat.message.font_size')

  const authJson = asString(config.authJson, DEFAULT_AUTH)
  const configToml = asString(config.configToml, DEFAULT_TOML)

  const handleAuthChange = useCallback((next: string) => onChange({ ...config, authJson: next }), [config, onChange])

  const handleConfigChange = useCallback(
    (next: string) => onChange({ ...config, configToml: next }),
    [config, onChange]
  )

  return (
    <>
      <Section title={t('code.adv.codex.auth_json')} description={t('code.config_json_hint')}>
        <CodeEditor
          theme={activeCmTheme}
          fontSize={fontSize - 4}
          value={authJson}
          language="json"
          onChange={handleAuthChange}
          height="140px"
          expanded={false}
          wrapped
          className="overflow-hidden rounded-md border border-border/40"
          options={{ lint: true, lineNumbers: true, foldGutter: true, keymap: true }}
        />
      </Section>

      <Section title={t('code.adv.codex.config_toml')} description={t('code.config_json_hint')}>
        <CodeEditor
          theme={activeCmTheme}
          fontSize={fontSize - 4}
          value={configToml}
          language={'plaintext'}
          onChange={handleConfigChange}
          height="240px"
          expanded={false}
          wrapped
          className="overflow-hidden rounded-md border border-border/40"
          options={{ lineNumbers: true, foldGutter: true, keymap: true }}
        />
      </Section>
    </>
  )
}
