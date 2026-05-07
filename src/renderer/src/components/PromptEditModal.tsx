import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Textarea
} from '@cherrystudio/ui'
import type { Prompt } from '@shared/data/types/prompt'
import { PROMPT_CONTENT_MAX, PROMPT_TITLE_MAX } from '@shared/data/types/prompt'
import { type FC, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface FormData {
  title: string
  content: string
}

interface PromptEditModalProps {
  open: boolean
  prompt?: Prompt | null
  saving?: boolean
  onSave: (data: { title: string; content: string }) => Promise<void>
  onCancel: () => void
}

const PromptEditModal: FC<PromptEditModalProps> = ({ open, prompt, saving, onSave, onCancel }) => {
  const { t } = useTranslation()
  const [formData, setFormData] = useState<FormData>({ title: '', content: '' })
  const [isSubmitting, setIsSubmitting] = useState(false)

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

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[600px]" onPointerDownOutside={(event) => event.preventDefault()}>
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

          <label className="flex flex-col gap-1 font-medium text-foreground text-sm">
            {t('settings.prompts.contentLabel')}
            <Textarea.Input
              className="min-h-[184px] resize-none"
              placeholder={t('settings.prompts.contentPlaceholder')}
              value={formData.content}
              onValueChange={(content) => setFormData((current) => ({ ...current, content }))}
              rows={8}
            />
          </label>
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

export default PromptEditModal
