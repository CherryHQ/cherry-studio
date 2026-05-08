import { Button, CodeEditor, Field, FieldContent, FieldError, Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { usePromptProcessor } from '@renderer/hooks/usePromptProcessor'
import { fetchGenerate } from '@renderer/services/ApiService'
import { estimateTextTokens } from '@renderer/services/TokenService'
import { AGENT_PROMPT } from '@shared/config/prompts'
import type { Assistant } from '@shared/data/types/assistant'
import { Edit, Eye, Loader2, Sparkles, Undo2 } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'

import { FieldHeader } from '../../FieldHeader'
import { PromptVariablesTooltip } from '../../PromptVariablesTooltip'

interface Props {
  assistant?: Pick<Assistant, 'modelName'> | null
  assistantName?: string
  prompt: string
  promptError?: string
  onChange: (prompt: string) => void
}

const logger = loggerService.withContext('LibraryAssistantPromptSection')

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
const PromptSection: FC<Props> = ({ assistant, assistantName, prompt, promptError, onChange }) => {
  const { t } = useTranslation()
  const [fontSize] = usePreference('chat.message.font_size')
  const { activeCmTheme } = useCodeStyle()
  const [showPreview, setShowPreview] = useState(prompt.length > 0)
  const [generating, setGenerating] = useState(false)
  const [showUndoButton, setShowUndoButton] = useState(false)
  const [originalPrompt, setOriginalPrompt] = useState('')
  const promptInvalid = Boolean(promptError)
  const generateSource = prompt.trim() || assistantName?.trim() || ''

  const processedPrompt = usePromptProcessor({
    prompt,
    modelName: assistant?.modelName ?? undefined
  })

  const tokenCount = useMemo(() => estimateTextTokens(prompt), [prompt])

  const handlePromptChange = (nextPrompt: string) => {
    setShowUndoButton(false)
    onChange(nextPrompt)
  }

  const handleGeneratePrompt = async () => {
    if (!generateSource || generating) return

    setGenerating(true)
    setShowUndoButton(false)

    try {
      const generatedPrompt = await fetchGenerate({
        prompt: AGENT_PROMPT,
        content: generateSource
      })

      if (!generatedPrompt) return

      setOriginalPrompt(prompt)
      onChange(generatedPrompt)
      setShowUndoButton(true)
      setShowPreview(false)
    } catch (error) {
      logger.error('Failed to generate assistant prompt', error as Error)
    } finally {
      setGenerating(false)
    }
  }

  const handleUndoGeneratedPrompt = () => {
    onChange(originalPrompt)
    setShowUndoButton(false)
    setShowPreview(false)
  }

  // Flip back to edit mode when the prompt becomes empty (e.g. cleared in
  // another window) — there's nothing to preview.
  useEffect(() => {
    if (prompt.length === 0 && showPreview) setShowPreview(false)
  }, [prompt, showPreview])

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h3 className="mb-1 text-base text-foreground">{t('library.config.prompt.title')}</h3>
        <p className="text-muted-foreground/60 text-xs">{t('library.config.prompt.desc')}</p>
      </div>

      <Field data-invalid={promptInvalid || undefined} className="gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <FieldHeader
            label={
              <span className="flex items-center gap-1.5">
                <span>{t('library.config.prompt.label')}</span>
                <PromptVariablesTooltip />
              </span>
            }
            className="min-w-0 flex-1"
          />
          <div className="flex items-center gap-1.5">
            {showUndoButton && (
              <Tooltip content={t('common.undo')}>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={t('common.undo')}
                  onClick={handleUndoGeneratedPrompt}
                  className="flex h-6 min-h-0 w-6 items-center justify-center rounded-2xs border border-border/20 p-0 text-muted-foreground/60 shadow-none transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:ring-0">
                  <Undo2 size={10} />
                </Button>
              </Tooltip>
            )}
            <Tooltip content={t('library.config.prompt.generate')}>
              <Button
                type="button"
                variant="ghost"
                aria-label={t('library.config.prompt.generate')}
                onClick={handleGeneratePrompt}
                disabled={!generateSource || generating}
                className="flex h-6 min-h-0 w-6 items-center justify-center rounded-2xs border border-border/20 p-0 text-muted-foreground/60 shadow-none transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-40">
                {generating ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
              </Button>
            </Tooltip>
            <Button
              variant="ghost"
              onClick={() => setShowPreview((v) => !v)}
              disabled={prompt.length === 0}
              className="flex h-auto min-h-0 items-center gap-1 rounded-2xs border border-border/20 px-2 py-[3px] font-normal text-muted-foreground/60 text-xs shadow-none transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-40">
              {showPreview ? <Edit size={10} /> : <Eye size={10} />}
              <span>{t(showPreview ? 'common.edit' : 'common.preview')}</span>
            </Button>
          </div>
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
                className="markdown max-h-[50vh] min-h-[200px] overflow-auto p-3 text-foreground text-xs"
                onDoubleClick={() => setShowPreview(false)}>
                <ReactMarkdown>{processedPrompt || prompt}</ReactMarkdown>
              </div>
            ) : (
              <CodeEditor
                theme={activeCmTheme}
                fontSize={fontSize - 1}
                value={prompt}
                language="markdown"
                onChange={handlePromptChange}
                expanded={false}
                minHeight="200px"
                maxHeight="50vh"
                placeholder={t('library.config.prompt.placeholder')}
              />
            )}
          </div>
          <FieldError className="text-xs" errors={promptError ? [{ message: promptError }] : undefined} />
          <div className="flex justify-between text-muted-foreground/50 text-xs">
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
