import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Dialog, DialogContent, DialogTitle, FieldError, Input, Label } from '@cherrystudio/ui'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'

interface TopicGroupNameDialogProps {
  open: boolean
  title: string
  submitLabel: string
  initialName: string
  onSubmit: (name: string) => Promise<void>
  onOpenChange: (open: boolean) => void
}

export function TopicGroupNameDialog({
  open,
  title,
  submitLabel,
  initialName,
  onSubmit,
  onOpenChange
}: TopicGroupNameDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(initialName)
    setHasAttemptedSubmit(false)
    setSubmitError(null)
  }, [initialName, open])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalizedName = name.trim()
    setHasAttemptedSubmit(true)
    setSubmitError(null)
    if (!normalizedName) return

    setIsSubmitting(true)
    try {
      await onSubmit(normalizedName)
      onOpenChange(false)
    } catch (error) {
      setSubmitError(formatErrorMessageWithPrefix(error, t('chat.topics.subject.error')))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeOnOverlayClick={false} size="sm">
        <DialogTitle>{title}</DialogTitle>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="topic-subject-group-name">{t('common.name')}</Label>
            <Input
              id="topic-subject-group-name"
              autoFocus
              value={name}
              aria-invalid={hasAttemptedSubmit && !name.trim()}
              placeholder={t('chat.topics.subject.name_placeholder')}
              onChange={(event) => {
                setName(event.target.value)
                setSubmitError(null)
              }}
            />
            {hasAttemptedSubmit && !name.trim() ? (
              <FieldError>{t('chat.topics.subject.name_required')}</FieldError>
            ) : null}
            {submitError ? <FieldError>{submitError}</FieldError> : null}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="emphasis" loading={isSubmitting}>
              {submitLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
