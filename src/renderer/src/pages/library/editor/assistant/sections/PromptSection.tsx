import { Button, CodeEditor, Field, FieldContent, FieldError, FieldLabel, Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { usePromptProcessor } from '@renderer/hooks/usePromptProcessor'
import { estimateTextTokens } from '@renderer/services/TokenService'
import type { Assistant } from '@shared/data/types/assistant'
import { Edit, Eye, HelpCircle } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'

interface Props {
  assistant?: Pick<Assistant, 'modelName'> | null
  prompt: string
  promptError?: string
  onChange: (prompt: string) => void
}

/** Variable catalogue — mirrors legacy `assistants.presets.add.prompt.variables.tip.content`. */
const PROMPT_VARIABLES: { name: string; i18n: string }[] = [
  { name: '{{date}}', i18n: 'library.config.prompt.vars.date' },
  { name: '{{time}}', i18n: 'library.config.prompt.vars.time' },
  { name: '{{datetime}}', i18n: 'library.config.prompt.vars.datetime' },
  { name: '{{system}}', i18n: 'library.config.prompt.vars.os' },
  { name: '{{arch}}', i18n: 'library.config.prompt.vars.arch' },
  { name: '{{language}}', i18n: 'library.config.prompt.vars.language' },
  { name: '{{model_name}}', i18n: 'library.config.prompt.vars.model_name' },
  { name: '{{username}}', i18n: 'library.config.prompt.vars.username' }
]

/**
 * Prompt editor — writes the top-level `prompt` column on the assistant.
 *
 * Feature parity with the legacy `AssistantPromptSettings` *prompt* half
 * (name / emoji live in BasicSection in v2). Keeps CodeEditor (markdown) /
 * ReactMarkdown preview toggle, 8-variable tooltip, Token count, and
 * double-click-preview-to-edit. Save cadence is the v2 top-bar global PATCH,
 * not the legacy's per-field instant save.
 *
 * TODO(v2-llm-migration): `usePromptProcessor` → `replacePromptVariables`
 * transitively reads Redux (`store.getState().llm.defaultModel?.name` fallback
 * when `assistant.modelName` is null) and legacy IPC
 * (`window.api.system.getDeviceType()` / `window.api.getAppInfo().arch` for
 * {{system}} / {{arch}}). Same Redux / legacy-IPC cluster as BasicSection's
 * ModelAvatar / SelectChatModelPopup / useProviders — should land together in
 * the same follow-up PR. Kept here so the editor matches legacy UX.
 */
const PromptSection: FC<Props> = ({ assistant, prompt, promptError, onChange }) => {
  const { t } = useTranslation()
  const [fontSize] = usePreference('chat.message.font_size')
  const { activeCmTheme } = useCodeStyle()
  const [showPreview, setShowPreview] = useState(prompt.length > 0)
  const promptInvalid = Boolean(promptError)

  const processedPrompt = usePromptProcessor({
    prompt,
    modelName: assistant?.modelName ?? undefined
  })

  const tokenCount = useMemo(() => estimateTextTokens(prompt), [prompt])

  // Flip back to edit mode when the prompt becomes empty (e.g. cleared in
  // another window) — there's nothing to preview.
  useEffect(() => {
    if (prompt.length === 0 && showPreview) setShowPreview(false)
  }, [prompt, showPreview])

  const variablesTip = (
    <div className="min-w-[200px]">
      <div className="mb-1.5 font-medium text-xs text-foreground">{t('library.config.prompt.variables_title')}</div>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-xs text-muted-foreground">
        {PROMPT_VARIABLES.map((v) => (
          <div key={v.name} className="contents">
            <span className="text-foreground/80">{v.name}</span>
            <span>{t(v.i18n)}</span>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h3 className="mb-1 text-base text-foreground">{t('library.config.prompt.title')}</h3>
        <p className="text-xs text-muted-foreground/60">{t('library.config.prompt.desc')}</p>
      </div>

      <Field data-invalid={promptInvalid || undefined} className="gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <FieldLabel className="flex items-center gap-1.5 font-normal text-sm text-muted-foreground/60">
            <span>{t('library.config.prompt.label')}</span>
            <Tooltip content={variablesTip} placement="top" classNames={{ content: 'max-w-none' }}>
              <HelpCircle size={11} className="cursor-help text-muted-foreground/50 hover:text-foreground" />
            </Tooltip>
          </FieldLabel>
          <Button
            variant="ghost"
            onClick={() => setShowPreview((v) => !v)}
            disabled={prompt.length === 0}
            className="flex h-auto min-h-0 items-center gap-1 rounded-2xs border border-border/20 px-2 py-[3px] font-normal text-xs text-muted-foreground/60 shadow-none transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-40">
            {showPreview ? <Edit size={10} /> : <Eye size={10} />}
            <span>{t(showPreview ? 'common.edit' : 'common.preview')}</span>
          </Button>
        </div>

        <FieldContent>
          <div
            aria-invalid={promptInvalid || undefined}
            className={`overflow-hidden rounded-xs border bg-accent/15 transition-all focus-within:bg-accent/20 ${
              promptInvalid
                ? 'border-destructive/50 focus-within:border-destructive/60'
                : 'border-border/20 focus-within:border-border/40'
            }`}>
            {showPreview ? (
              <div
                className="markdown max-h-[50vh] min-h-[200px] overflow-auto p-3 text-xs text-foreground"
                onDoubleClick={() => setShowPreview(false)}>
                <ReactMarkdown>{processedPrompt || prompt}</ReactMarkdown>
              </div>
            ) : (
              <CodeEditor
                theme={activeCmTheme}
                fontSize={fontSize - 1}
                value={prompt}
                language="markdown"
                onChange={onChange}
                expanded={false}
                minHeight="200px"
                maxHeight="50vh"
                placeholder={t('library.config.prompt.placeholder')}
              />
            )}
          </div>
          <FieldError className="text-xs" errors={promptError ? [{ message: promptError }] : undefined} />
          <div className="flex justify-between text-xs text-muted-foreground/50">
            <span>{t('library.config.prompt.dblclick_hint')}</span>
            <span className="tabular-nums">
              {t('library.config.prompt.tokens_label')}
              {tokenCount}
            </span>
          </div>
        </FieldContent>
      </Field>
    </div>
  )
}

export default PromptSection
