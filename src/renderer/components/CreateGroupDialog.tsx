import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldError,
  Input
} from '@cherrystudio/ui'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface CreateGroupDialogProps {
  open: boolean
  onCreate: (name: string) => Promise<unknown>
  onOpenChange: (open: boolean) => void
  errorMessage?: string
  isSubmitting?: boolean
  namePlaceholder?: string
  nameRequiredMessage?: string
  submitLabel?: string
  title?: string
}

export function CreateGroupDialog({
  open,
  onCreate,
  onOpenChange,
  errorMessage,
  isSubmitting = false,
  namePlaceholder,
  nameRequiredMessage,
  submitLabel,
  title
}: CreateGroupDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false)
  const [isSubmittingInternally, setIsSubmittingInternally] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const submitting = isSubmitting || isSubmittingInternally

  useEffect(() => {
    if (open) return

    setName('')
    setHasAttemptedSubmit(false)
    setIsSubmittingInternally(false)
    setSubmitError(null)
  }, [open])

  const handleOpenChange = (nextOpen: boolean) => {
    if (submitting) return
    onOpenChange(nextOpen)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting) return

    const normalizedName = name.trim()
    setHasAttemptedSubmit(true)
    setSubmitError(null)
    if (!normalizedName) return

    setIsSubmittingInternally(true)
    try {
      await onCreate(normalizedName)
      onOpenChange(false)
    } catch (error) {
      setSubmitError(formatErrorMessageWithPrefix(error, errorMessage ?? t('common.group.create_failed')))
    } finally {
      setIsSubmittingInternally(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent closeOnOverlayClick={false} size="sm">
        <DialogHeader>
          <DialogTitle>{title ?? t('common.group.create')}</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div>
            <Input
              autoFocus
              maxLength={64}
              value={name}
              aria-label={t('common.name')}
              aria-invalid={hasAttemptedSubmit && !name.trim()}
              placeholder={namePlaceholder ?? t('common.group.name_placeholder')}
              disabled={submitting}
              onChange={(event) => {
                setName(event.target.value)
                setHasAttemptedSubmit(false)
                setSubmitError(null)
              }}
            />
            {hasAttemptedSubmit && !name.trim() ? (
              <div className="mt-2">
                <FieldError>{nameRequiredMessage ?? t('common.group.name_required')}</FieldError>
              </div>
            ) : submitError ? (
              <div className="mt-2">
                <FieldError>{submitError}</FieldError>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={submitting} onClick={() => handleOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="emphasis" loading={submitting}>
              {submitLabel ?? t('common.add')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
