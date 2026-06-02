import { Button, Dialog, DialogContent, FieldError, Input, Label } from '@cherrystudio/ui'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  KnowledgeDialogBody,
  KnowledgeDialogField,
  KnowledgeDialogFooter,
  KnowledgeDialogHeader
} from './KnowledgeDialogLayout'

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
      <DialogContent size="sm">
        <KnowledgeDialogHeader>{title}</KnowledgeDialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <KnowledgeDialogBody>
            <KnowledgeDialogField>
              <Label htmlFor="knowledge-entity-name">{t('common.name')}</Label>
              <Input
                id="knowledge-entity-name"
                autoFocus
                value={name}
                aria-invalid={hasAttemptedSubmit && !name.trim()}
                placeholder={namePlaceholder}
                onChange={(event) => {
                  setName(event.target.value)
                  setSubmitError(null)
                }}
              />
              {hasAttemptedSubmit && !name.trim() ? <FieldError>{nameRequiredMessage}</FieldError> : null}
              {submitError ? <FieldError>{submitError}</FieldError> : null}
            </KnowledgeDialogField>
          </KnowledgeDialogBody>

          <KnowledgeDialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="emphasis" loading={isSubmitting}>
              {submitLabel}
            </Button>
          </KnowledgeDialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default KnowledgeEntityNameDialog
