import { Button, Input, Textarea } from '@cherrystudio/ui'
import { type Prompt, PROMPT_CONTENT_MAX, PROMPT_TITLE_MAX } from '@shared/data/types/prompt'
import { Braces } from 'lucide-react'
import type { FC } from 'react'
import { useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { usePromptMutations, usePromptMutationsById } from '../../adapters/promptAdapter'
import { ResourceEditorShell } from '../ConfigEditorShell'
import { useResourceEditorState } from '../useResourceEditorState'

interface Props {
  prompt?: Prompt
  onBack: () => void
  onCreated?: (created: Prompt) => void
}

interface PromptFormState {
  title: string
  content: string
}

type PromptSaveIntent =
  | { kind: 'create'; payload: { title: string; content: string } }
  | { kind: 'update'; payload: Partial<{ title: string; content: string }> }

function initialPromptFormState(prompt?: Prompt): PromptFormState {
  return {
    title: prompt?.title ?? '',
    content: prompt?.content ?? ''
  }
}

function isValidPromptForm(form: PromptFormState): boolean {
  const trimmedTitle = form.title.trim()
  return (
    trimmedTitle.length > 0 &&
    trimmedTitle.length <= PROMPT_TITLE_MAX &&
    form.content.length > 0 &&
    form.content.length <= PROMPT_CONTENT_MAX
  )
}

function diffPromptSaveIntent(
  form: PromptFormState,
  baseline: PromptFormState,
  prompt?: Prompt
): PromptSaveIntent | null {
  if (!isValidPromptForm(form)) return null

  const next = {
    title: form.title,
    content: form.content
  }

  if (!prompt) {
    return { kind: 'create', payload: next }
  }

  const payload: Partial<{ title: string; content: string }> = {}
  if (next.title !== baseline.title) payload.title = next.title
  if (next.content !== baseline.content) payload.content = next.content

  return Object.keys(payload).length > 0 ? { kind: 'update', payload } : null
}

const VARIABLE_PLACEHOLDER = '${variable}'
const VARIABLE_PATTERN = /\$\{[^}\r\n]+\}/g

function extractPromptVariables(content: string): string[] {
  const variables = content.match(VARIABLE_PATTERN) ?? []
  return Array.from(new Set(variables))
}

const PromptConfigPage: FC<Props> = ({ prompt, onBack, onCreated }) => {
  const { t } = useTranslation()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isCreate = !prompt

  const { createPrompt } = usePromptMutations()
  const { updatePrompt } = usePromptMutationsById(prompt?.id ?? '')
  const initialForm = useMemo(() => initialPromptFormState(prompt), [prompt])

  const { form, onChange, canSave, saving, saved, error, handleSave } = useResourceEditorState<
    PromptFormState,
    PromptSaveIntent
  >({
    initialForm,
    baselineKey: prompt?.id ?? null,
    diff: (nextForm, baseline) => diffPromptSaveIntent(nextForm, baseline, prompt),
    onCommit: async (intent) => {
      if (intent.kind === 'create') {
        const created = await createPrompt(intent.payload)
        onCreated?.(created)
        const next = initialPromptFormState(created)
        return { nextBaseline: next, nextForm: next }
      }

      const updated = await updatePrompt(intent.payload)
      const next = initialPromptFormState(updated)
      return { nextBaseline: next, nextForm: next }
    },
    fallbackErrorMessage: t('library.config.save_failed')
  })

  const titleError =
    form.title.length > 0 && form.title.trim().length === 0
      ? t('common.required_field')
      : form.title.trim().length > PROMPT_TITLE_MAX
        ? t('library.config.prompt.field.name.too_long', { max: PROMPT_TITLE_MAX })
        : null
  const contentError =
    form.content.length > PROMPT_CONTENT_MAX
      ? t('library.config.prompt.field.content.too_long', { max: PROMPT_CONTENT_MAX })
      : null
  const title = isCreate ? form.title.trim() || t('library.type.new_prompt') : form.title.trim() || prompt?.title || ''
  const referencedVariables = useMemo(() => extractPromptVariables(form.content), [form.content])

  const insertVariable = () => {
    const textarea = textareaRef.current
    const start = textarea?.selectionStart ?? form.content.length
    const end = textarea?.selectionEnd ?? form.content.length
    const nextContent = `${form.content.slice(0, start)}${VARIABLE_PLACEHOLDER}${form.content.slice(end)}`
    onChange({ content: nextContent })

    requestAnimationFrame(() => {
      const nextCursor = start + VARIABLE_PLACEHOLDER.length
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(nextCursor, nextCursor)
    })
  }

  return (
    <ResourceEditorShell
      title={title}
      onBack={onBack}
      saved={saved}
      error={error}
      saveButton={{ canSave, saving, onSave: handleSave }}>
      <div className="flex min-h-0 flex-1 justify-center overflow-y-auto px-8 py-7 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/30 [&::-webkit-scrollbar]:w-[3px]">
        <div className="w-full max-w-[860px] space-y-8">
          <label className="block">
            <span className="mb-3 block font-semibold text-muted-foreground/80 text-sm">
              {t('library.config.prompt.field.name.label')}
            </span>
            <Input
              value={form.title}
              onChange={(event) => onChange({ title: event.target.value })}
              placeholder={t('settings.prompts.titlePlaceholder')}
              aria-invalid={Boolean(titleError) || undefined}
              className="h-14 w-full rounded-[28px] border border-border/25 bg-background px-5 text-foreground text-lg shadow-xs outline-none transition-all placeholder:text-muted-foreground/45 focus-visible:border-border/45 focus-visible:ring-0 aria-invalid:border-destructive/50"
            />
            {titleError && <span className="mt-1.5 block text-destructive/80 text-xs">{titleError}</span>}
          </label>

          <div className="block">
            <div className="mb-3 flex items-center justify-between gap-3">
              <label htmlFor="library-prompt-content" className="font-semibold text-muted-foreground/80 text-sm">
                {t('library.config.prompt.field.content.label')}
              </label>
              <Button
                type="button"
                variant="ghost"
                onClick={insertVariable}
                className="flex h-auto min-h-0 items-center gap-1 rounded-full px-2 py-1 font-semibold text-sm text-violet-500 shadow-none transition-colors hover:bg-violet-500/10 hover:text-violet-600 focus-visible:ring-0">
                <Braces size={13} />
                <span>{t('library.config.prompt.insert_variable')}</span>
              </Button>
            </div>
            <Textarea.Input
              id="library-prompt-content"
              ref={textareaRef}
              value={form.content}
              onValueChange={(content) => onChange({ content })}
              placeholder={t('settings.prompts.contentPlaceholder')}
              hasError={Boolean(contentError)}
              spellCheck={false}
              className="min-h-[360px] resize-none rounded-[24px] border border-border/25 bg-background px-5 py-5 text-base leading-8 shadow-xs placeholder:text-muted-foreground/45 focus-visible:border-border/45 focus-visible:ring-0 md:text-base"
            />
            {contentError && <span className="mt-1.5 block text-destructive/80 text-xs">{contentError}</span>}
            <p className="mt-2 text-muted-foreground/45 text-sm">{t('library.config.prompt.variable_hint')}</p>
          </div>

          {referencedVariables.length > 0 && (
            <div className="space-y-3">
              <span className="block font-semibold text-muted-foreground/80 text-sm">
                {t('library.config.prompt.referenced_variables')}
              </span>
              <div className="flex flex-wrap gap-2">
                {referencedVariables.map((variable) => (
                  <span
                    key={variable}
                    className="rounded-full bg-violet-500/10 px-3 py-1 font-mono text-sm text-violet-500 leading-none">
                    {variable}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </ResourceEditorShell>
  )
}

export default PromptConfigPage
