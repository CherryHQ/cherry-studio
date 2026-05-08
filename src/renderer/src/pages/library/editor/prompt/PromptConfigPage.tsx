import { Button, Input, Textarea } from '@cherrystudio/ui'
import { type Prompt, PROMPT_CONTENT_MAX, PROMPT_TITLE_MAX } from '@shared/data/types/prompt'
import { ArrowLeft, Braces, Save } from 'lucide-react'
import type { FC } from 'react'
import { useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { usePromptMutations, usePromptMutationsById } from '../../adapters/promptAdapter'
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
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex h-16 shrink-0 items-center gap-3 border-border/35 border-b px-7">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onBack}
          aria-label={t('common.back')}
          className="h-8 w-8 rounded-full text-muted-foreground/45 shadow-none hover:bg-accent/45 hover:text-foreground focus-visible:ring-0">
          <ArrowLeft size={18} />
        </Button>
        <h2 className="font-semibold text-foreground text-lg">
          {t(isCreate ? 'library.config.prompt.create_title' : 'library.config.prompt.edit_title')}
        </h2>
        <div className="flex-1" />
        {saved && <span className="text-primary text-xs">{t('common.saved')}</span>}
        {error && <span className="text-destructive text-xs">{error}</span>}
        <Button
          variant="default"
          onClick={handleSave}
          disabled={saving || !canSave}
          className="flex h-9 min-h-0 items-center gap-1.5 rounded-full px-4 font-normal shadow-sm transition-transform active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-35">
          <Save size={14} className="lucide-custom" />
          <span>{saving ? t('library.config.saving') : t('common.save')}</span>
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 justify-center overflow-y-auto px-6 py-9 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/30 [&::-webkit-scrollbar]:w-[3px]">
        <div className="w-full max-w-[760px] space-y-8">
          <label className="block">
            <span className="mb-3 block font-medium text-muted-foreground/55 text-sm">
              {t('library.config.prompt.field.name.label')}
            </span>
            <Input
              value={form.title}
              onChange={(event) => onChange({ title: event.target.value })}
              placeholder={t('settings.prompts.titlePlaceholder')}
              aria-invalid={Boolean(titleError) || undefined}
              className="h-12 rounded-[20px] border-border/25 bg-accent/[0.03] px-5 text-base shadow-sm outline-none transition-colors placeholder:text-muted-foreground/35 focus-visible:border-border/45 focus-visible:ring-0"
            />
            {titleError && <span className="mt-1.5 block text-destructive/80 text-xs">{titleError}</span>}
          </label>

          <div className="block">
            <div className="mb-3 flex items-center justify-between gap-3">
              <label htmlFor="library-prompt-content" className="font-medium text-muted-foreground/55 text-sm">
                {t('library.config.prompt.field.content.label')}
              </label>
              <Button
                type="button"
                variant="ghost"
                onClick={insertVariable}
                className="flex h-auto min-h-0 items-center gap-1 rounded-full px-2 py-1 font-medium text-primary/70 text-xs shadow-none hover:bg-primary/10 hover:text-primary focus-visible:ring-0">
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
              className="min-h-[320px] resize-none rounded-[20px] border-border/25 bg-accent/[0.03] px-5 py-5 text-base leading-7 shadow-sm placeholder:text-muted-foreground/35 focus-visible:border-border/45 focus-visible:ring-0 md:text-base"
            />
            {contentError && <span className="mt-1.5 block text-destructive/80 text-xs">{contentError}</span>}
          </div>
        </div>
      </div>
    </div>
  )
}

export default PromptConfigPage
