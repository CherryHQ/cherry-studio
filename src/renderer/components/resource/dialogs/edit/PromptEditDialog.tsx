import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Tooltip
} from '@cherrystudio/ui'
import PromptEditorField, { type PromptEditorFieldHandles } from '@renderer/components/PromptEditorField'
import type { Prompt } from '@shared/data/types/prompt'
import { PROMPT_CONTENT_MAX, PROMPT_TITLE_MAX } from '@shared/data/types/prompt'
import { Braces } from 'lucide-react'
import { type FC, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface FormData {
  title: string
  content: string
}

interface PromptEditDialogProps {
  open: boolean
  prompt?: Prompt | null
  saving?: boolean
  onSave: (data: { title: string; content: string }) => Promise<void>
  onCancel: () => void
}

const PromptEditDialog: FC<PromptEditDialogProps> = ({ open, prompt, saving, onSave, onCancel }) => {
  const { t } = useTranslation()
  const [formData, setFormData] = useState<FormData>({ title: '', content: '' })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [resetPreviewKey, setResetPreviewKey] = useState(0)
  const promptEditorRef = useRef<PromptEditorFieldHandles | null>(null)
  const variablePlaceholder = t('settings.prompts.variablePlaceholder')

  const isEdit = !!prompt
  const trimmedTitleLength = formData.title.trim().length
  const canSave =
    trimmedTitleLength > 0 &&
    trimmedTitleLength <= PROMPT_TITLE_MAX &&
    formData.content.length > 0 &&
    formData.content.length <= PROMPT_CONTENT_MAX
  const isSaving = saving || isSubmitting

  useEffect(() => {
    if (open) {
      setFormData({
        title: prompt?.title ?? '',
        content: prompt?.content ?? ''
      })
    } else {
      setIsSubmitting(false)
    }
  }, [open, prompt])

  const handleOk = useCallback(async () => {
    if (!canSave) {
      return
    }

    try {
      setIsSubmitting(true)
      await onSave({
        title: formData.title,
        content: formData.content
      })
    } catch {
      // Parent mutation handlers surface the error; keep the modal usable.
    } finally {
      setIsSubmitting(false)
    }
  }, [canSave, formData, onSave])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        onCancel()
      }
    },
    [onCancel]
  )

  const appendVariable = useCallback(() => {
    setFormData((current) => {
      const separator = current.content.length > 0 && !/\s$/.test(current.content) ? ' ' : ''

      return {
        ...current,
        content: `${current.content}${separator}${variablePlaceholder}`
      }
    })
    setResetPreviewKey((key) => key + 1)
  }, [variablePlaceholder])

  const handleInsertVariable = useCallback(() => {
    const insertedAtCursor = promptEditorRef.current?.insertText(variablePlaceholder) ?? false
    if (!insertedAtCursor) {
      appendVariable()
    }
  }, [appendVariable, variablePlaceholder])

  const promptActions = (
    <Tooltip content={t('library.config.prompt.insert_variable')}>
      <Button
        type="button"
        variant="ghost"
        aria-label={t('library.config.prompt.insert_variable')}
        onClick={handleInsertVariable}
        disabled={isSaving}
        className="flex h-6 min-h-0 w-6 items-center justify-center rounded-2xs border border-border/20 p-0 text-muted-foreground/80 shadow-none transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-40">
        <Braces size={10} />
      </Button>
    </Tooltip>
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? t('settings.prompts.edit') : t('settings.prompts.add')}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 font-medium text-foreground text-sm">
            {t('settings.prompts.titleLabel')}
            <Input
              placeholder={t('settings.prompts.titlePlaceholder')}
              value={formData.title}
              onChange={(event) => setFormData((current) => ({ ...current, title: event.target.value }))}
            />
          </label>

          <PromptEditorField
            ref={promptEditorRef}
            label={<span className="font-medium text-foreground text-sm">{t('settings.prompts.contentLabel')}</span>}
            value={formData.content}
            onChange={(content) => setFormData((current) => ({ ...current, content }))}
            placeholder={t('settings.prompts.contentPlaceholder')}
            actions={promptActions}
            resetPreviewKey={resetPreviewKey}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isSaving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void handleOk()} loading={isSaving} disabled={!canSave || isSaving}>
            {t('common.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default PromptEditDialog
