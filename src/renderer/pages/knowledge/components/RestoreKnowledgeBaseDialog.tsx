import {
  Dialog,
  DialogContent,
  FieldError,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cherrystudio/ui'
import type { RestoreKnowledgeBaseInput } from '@renderer/hooks/useKnowledgeBase'
import { useModels } from '@renderer/hooks/useModel'
import type { KnowledgeSelectOption } from '@renderer/pages/knowledge/types'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { MODEL_CAPABILITY } from '@shared/data/types/model'
import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useEmbeddingDimensions } from '../hooks/useEmbeddingDimensions'
import CreateKnowledgeBaseDialog, { formatKnowledgeModelOptionLabel } from './CreateKnowledgeBaseDialog'
import { KnowledgeDialogBody, KnowledgeDialogField } from './KnowledgeDialogLayout'

interface RestoreKnowledgeBaseDialogProps {
  open: boolean
  base: KnowledgeBase
  initialEmbeddingModelId?: string | null
  isRestoring: boolean
  restoreBase: (input: RestoreKnowledgeBaseInput) => Promise<KnowledgeBase>
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
  const { models: embeddingModels } = useModels({
    capability: MODEL_CAPABILITY.EMBEDDING,
    enabled: true
  })
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

  const embeddingModelOptions: KnowledgeSelectOption[] = embeddingModels.map((model) => ({
    value: model.id,
    label: formatKnowledgeModelOptionLabel(model.id)
  }))

  const handleEmbeddingModelChange = (embeddingModelId: string) => {
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

    let restoredBase: KnowledgeBase

    try {
      restoredBase = await restoreBase({
        sourceBaseId: base.id,
        name: values.name,
        embeddingModelId: values.embeddingModelId,
        dimensions
      })
    } catch (error) {
      setSubmitError(formatErrorMessageWithPrefix(error, t('knowledge.restore.failed_to_restore')))
      return
    }

    onRestored(restoredBase)
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
              <Select value={values.embeddingModelId ?? undefined} onValueChange={handleEmbeddingModelChange}>
                <SelectTrigger
                  size="sm"
                  className="w-full"
                  aria-invalid={hasAttemptedSubmit && !values.embeddingModelId}>
                  <SelectValue placeholder={t('knowledge.not_set')} />
                </SelectTrigger>
                <SelectContent>
                  {embeddingModelOptions.length > 0 ? (
                    embeddingModelOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))
                  ) : (
                    <div className="px-2.5 py-2 text-foreground-muted text-sm">{t('knowledge.not_set')}</div>
                  )}
                </SelectContent>
              </Select>
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
