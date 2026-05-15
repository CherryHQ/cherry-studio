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
import type { FormEvent, KeyboardEvent } from 'react'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface EditNameDialogProps {
  initialName: string
  inputLabel?: string
  onOpenChange: (open: boolean) => void
  onSubmit: (name: string) => void | Promise<void>
  open: boolean
  placeholder?: string
  submitLabel?: string
  title: string
}

const EditNameDialog = ({
  initialName,
  inputLabel,
  onOpenChange,
  onSubmit,
  open,
  placeholder,
  submitLabel,
  title
}: EditNameDialogProps) => {
  const { t } = useTranslation()
  const inputId = useId()
  const [name, setName] = useState(initialName)
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!open) {
      setName('')
      setHasAttemptedSubmit(false)
      setIsSubmitting(false)
      return
    }

    setName(initialName)
    setHasAttemptedSubmit(false)
    setIsSubmitting(false)
  }, [initialName, open])

  const submitName = async () => {
    const trimmedName = name.trim()
    setHasAttemptedSubmit(true)

    if (!trimmedName) return

    if (trimmedName === initialName.trim()) {
      onOpenChange(false)
      return
    }

    setIsSubmitting(true)
    try {
      await onSubmit(trimmedName)
      onOpenChange(false)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void submitName()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return

    event.preventDefault()
    void submitName()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 overflow-hidden rounded-2xl border-border/60 p-0">
        <DialogHeader className="gap-0.5 border-border/40 border-b px-4 py-3 text-left">
          <DialogTitle className="leading-4">{title}</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col" onSubmit={handleSubmit}>
          <div className="space-y-1 px-4 py-3">
            <Label htmlFor={inputId} className="text-muted-foreground leading-4">
              {inputLabel ?? t('common.name')}
            </Label>
            <Input
              id={inputId}
              aria-invalid={hasAttemptedSubmit && !name.trim()}
              autoFocus
              className="h-8 rounded-lg px-2.5 leading-4 placeholder:text-muted-foreground/70"
              placeholder={placeholder}
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                setHasAttemptedSubmit(false)
              }}
              onKeyDown={handleKeyDown}
            />
            {hasAttemptedSubmit && !name.trim() ? (
              <FieldError className="leading-4">{t('common.required_field')}</FieldError>
            ) : null}
          </div>
          <DialogFooter className="gap-2 border-border/40 border-t px-4 py-3 sm:justify-end">
            <Button type="button" variant="outline" className="h-8 rounded-lg px-3" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={isSubmitting} className="h-8 rounded-lg px-3">
              {submitLabel ?? t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default EditNameDialog
