import { Dialog, DialogContent, FieldError, Input, Label } from '@cherrystudio/ui'
import type { RestoreKnowledgeBaseInput } from '@renderer/hooks/useKnowledgeBase'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { KnowledgeBase, RestoreKnowledgeBaseResult } from '@shared/data/types/knowledge'
import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useEmbeddingDimensions } from '../hooks/useEmbeddingDimensions'
import CreateKnowledgeBaseDialog from './CreateKnowledgeBaseDialog'
import { KnowledgeDialogBody, KnowledgeDialogField } from './KnowledgeDialogLayout'
import { isEmbeddingModel, KnowledgeModelSelect } from './KnowledgeModelSelect'

interface RestoreKnowledgeBaseDialogProps {
  open: boolean
  base: KnowledgeBase
  initialEmbeddingModelId?: string | null
  isRestoring: boolean
  restoreBase: (input: RestoreKnowledgeBaseInput) => Promise<RestoreKnowledgeBaseResult>
  onOpenChange: (open: boolean) => void
  onRestored: (base: KnowledgeBase) => void
}

interface RestoreKnowledgeBaseFormValues {
  name: string
  embeddingModelId: string | null
}

const createInitialValues = (
  name: string,
  embeddingModelId: string | null | undefined
): RestoreKnowledgeBaseFormValues => ({
  name,
  embeddingModelId: embeddingModelId ?? null
})

const RestoreKnowledgeBaseDialog = ({
  open,
  base,
  initialEmbeddingModelId,
  isRestoring,
  restoreBase,
  onOpenChange,
  onRestored
}: RestoreKnowledgeBaseDialogProps) => {
  const { t } = useTranslation()
  const defaultName = t('knowledge.restore.default_name', { name: base.name })
  const [values, setValues] = useState<RestoreKnowledgeBaseFormValues>(() =>
    createInitialValues(defaultName, initialEmbeddingModelId)
  )
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const { fetchDimensions, isFetchingDimensions } = useEmbeddingDimensions()

  useEffect(() => {
    setValues(createInitialValues(defaultName, initialEmbeddingModelId))
    setHasAttemptedSubmit(false)
    setSubmitError(null)
  }, [base.id, defaultName, initialEmbeddingModelId, open])

  const handleEmbeddingModelChange = (embeddingModelId: string | null) => {
    setValues((currentValues) => ({ ...currentValues, embeddingModelId }))
    setSubmitError(null)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setHasAttemptedSubmit(true)
    setSubmitError(null)

    if (!values.name.trim() || !values.embeddingModelId) {
      return
    }

    let dimensions: number

    try {
      dimensions = await fetchDimensions(values.embeddingModelId)
    } catch (error) {
      setSubmitError(formatErrorMessageWithPrefix(error, t('message.error.get_embedding_dimensions')))
      return
    }

    let result: RestoreKnowledgeBaseResult

    try {
      result = await restoreBase({
        sourceBaseId: base.id,
        name: values.name,
        embeddingModelId: values.embeddingModelId,
        dimensions
      })
    } catch (error) {
      setSubmitError(formatErrorMessageWithPrefix(error, t('knowledge.restore.failed_to_restore')))
      return
    }

    // Restore drops root items whose source is gone (a v1-migrated directory child's virtual path,
    // a deleted file). Tell the user instead of silently restoring fewer items than expected.
    if (result.skippedMissingSourceCount > 0) {
      window.toast.warning(t('knowledge.restore.skipped_missing_sources', { count: result.skippedMissingSourceCount }))
    }

    onRestored(result.base)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <CreateKnowledgeBaseDialog.Header title={t('knowledge.restore.title')} />

        <CreateKnowledgeBaseDialog.Form onSubmit={handleSubmit}>
          <KnowledgeDialogBody>
            <KnowledgeDialogField>
              <Label htmlFor="knowledge-restore-name">{t('common.name')}</Label>
              <Input
                id="knowledge-restore-name"
                value={values.name}
                aria-invalid={hasAttemptedSubmit && !values.name.trim()}
                placeholder={t('common.name')}
                onChange={(event) => setValues((currentValues) => ({ ...currentValues, name: event.target.value }))}
              />
              {hasAttemptedSubmit && !values.name.trim() ? (
                <FieldError>{t('knowledge.name_required')}</FieldError>
              ) : null}
            </KnowledgeDialogField>

            <KnowledgeDialogField>
              <Label>{t('knowledge.embedding_model')}</Label>
              <KnowledgeModelSelect
                aria-label={t('knowledge.embedding_model')}
                value={values.embeddingModelId}
                placeholder={t('knowledge.not_set')}
                filter={isEmbeddingModel}
                invalid={hasAttemptedSubmit && !values.embeddingModelId}
                onChange={handleEmbeddingModelChange}
              />
              {hasAttemptedSubmit && !values.embeddingModelId ? (
                <FieldError>{t('knowledge.embedding_model_required')}</FieldError>
              ) : null}
            </KnowledgeDialogField>

            {submitError ? <FieldError>{submitError}</FieldError> : null}
          </KnowledgeDialogBody>

          <CreateKnowledgeBaseDialog.Actions
            isCreating={isRestoring || isFetchingDimensions}
            onCancel={() => onOpenChange(false)}
            cancelLabel={t('common.cancel')}
            submitLabel={t('knowledge.restore.submit')}
          />
        </CreateKnowledgeBaseDialog.Form>
      </DialogContent>
    </Dialog>
  )
}

export default RestoreKnowledgeBaseDialog
