import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldError,
  Input,
  Label
} from '@cherrystudio/ui'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface KnowledgeEntityNameDialogProps {
  open: boolean
  title: string
  submitLabel: string
  initialName: string
  isSubmitting: boolean
  submitErrorMessage: string
  namePlaceholder: string
  nameRequiredMessage: string
  onSubmit: (name: string) => Promise<void>
  onOpenChange: (open: boolean) => void
}

const KnowledgeEntityNameDialog = ({
  open,
  title,
  submitLabel,
  initialName,
  isSubmitting,
  submitErrorMessage,
  onSubmit,
  onOpenChange,
  namePlaceholder,
  nameRequiredMessage
}: KnowledgeEntityNameDialogProps) => {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setName('')
      setHasAttemptedSubmit(false)
      setSubmitError(null)
      return
    }

    setName(initialName)
    setHasAttemptedSubmit(false)
    setSubmitError(null)
  }, [initialName, open])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const normalizedName = name.trim()

    setHasAttemptedSubmit(true)
    setSubmitError(null)

    if (!normalizedName) {
      return
    }

    try {
      await onSubmit(normalizedName)
    } catch (error) {
      setSubmitError(formatErrorMessageWithPrefix(error, submitErrorMessage))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 overflow-hidden rounded-2xl border-border/60 p-0">
        <DialogHeader className="gap-0.5 border-border/40 border-b px-4 py-3 text-left">
          <DialogTitle className="leading-4">{title}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col">
          <div className="space-y-1 px-4 py-3">
            <Label htmlFor="knowledge-entity-name" className="text-muted-foreground leading-4">
              {t('common.name')}
            </Label>
            <Input
              id="knowledge-entity-name"
              autoFocus
              value={name}
              aria-invalid={hasAttemptedSubmit && !name.trim()}
              placeholder={namePlaceholder}
              className="h-8 rounded-lg px-2.5 leading-4 placeholder:text-muted-foreground/70"
              onChange={(event) => {
                setName(event.target.value)
                setSubmitError(null)
              }}
            />
            {hasAttemptedSubmit && !name.trim() ? (
              <FieldError className="leading-4">{nameRequiredMessage}</FieldError>
            ) : null}
            {submitError ? <FieldError className="leading-4">{submitError}</FieldError> : null}
          </div>

          <DialogFooter className="gap-2 border-border/40 border-t px-4 py-3 sm:justify-end">
            <Button type="button" variant="outline" className="h-8 rounded-lg px-3" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={isSubmitting} className="h-8 rounded-lg px-3">
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default KnowledgeEntityNameDialog
