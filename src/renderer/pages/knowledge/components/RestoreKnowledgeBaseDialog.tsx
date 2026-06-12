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
  initialDimensions?: number | null
  isRestoring: boolean
  restoreBase: (input: RestoreKnowledgeBaseInput) => Promise<KnowledgeBase>
  onOpenChange: (open: boolean) => void
  onRestored: (base: KnowledgeBase) => void
}

interface RestoreKnowledgeBaseFormValues {
  name: string
  embeddingModelId: string | null
  dimensions: string
}

const createInitialValues = (
  name: string,
  embeddingModelId: string | null | undefined,
  dimensions: number | null | undefined
): RestoreKnowledgeBaseFormValues => ({
  name,
  embeddingModelId: embeddingModelId ?? null,
  dimensions: dimensions == null ? '' : dimensions.toString()
})

const parseKnowledgeDimensions = (dimensions: string) => {
  const parsedDimensions = Number(dimensions)

  return Number.isSafeInteger(parsedDimensions) && parsedDimensions > 0 ? parsedDimensions : null
}

const RestoreKnowledgeBaseDialog = ({
  open,
  base,
  initialEmbeddingModelId,
  initialDimensions,
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
    createInitialValues(defaultName, initialEmbeddingModelId, initialDimensions)
  )
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false)
  const [hasAttemptedManualDimensionsSubmit, setHasAttemptedManualDimensionsSubmit] = useState(false)
  const [isManualDimensionsVisible, setIsManualDimensionsVisible] = useState(initialDimensions != null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const { fetchDimensions, isFetchingDimensions } = useEmbeddingDimensions()

  useEffect(() => {
    setValues(createInitialValues(defaultName, initialEmbeddingModelId, initialDimensions))
    setHasAttemptedSubmit(false)
    setHasAttemptedManualDimensionsSubmit(false)
    setIsManualDimensionsVisible(initialDimensions != null)
    setSubmitError(null)
  }, [base.id, defaultName, initialDimensions, initialEmbeddingModelId, open])

  const embeddingModelOptions: KnowledgeSelectOption[] = embeddingModels.map((model) => ({
    value: model.id,
    label: formatKnowledgeModelOptionLabel(model.id)
  }))
  const manualDimensions = parseKnowledgeDimensions(values.dimensions)
  const isManualDimensionsInvalid = isManualDimensionsVisible && hasAttemptedManualDimensionsSubmit && !manualDimensions

  const handleEmbeddingModelChange = (embeddingModelId: string) => {
    setValues((currentValues) => ({
      ...currentValues,
      embeddingModelId,
      dimensions: ''
    }))
    setHasAttemptedManualDimensionsSubmit(false)
    setIsManualDimensionsVisible(false)
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

    if (isManualDimensionsVisible) {
      setHasAttemptedManualDimensionsSubmit(true)

      if (!manualDimensions) {
        return
      }

      dimensions = manualDimensions
    } else {
      try {
        dimensions = await fetchDimensions(values.embeddingModelId)
      } catch (error) {
        setIsManualDimensionsVisible(true)
        setHasAttemptedManualDimensionsSubmit(false)
        setSubmitError(formatErrorMessageWithPrefix(error, t('message.error.get_embedding_dimensions')))
        return
      }
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

            {isManualDimensionsVisible ? (
              <KnowledgeDialogField>
                <Label htmlFor="knowledge-restore-dimensions">{t('knowledge.dimensions')}</Label>
                <Input
                  id="knowledge-restore-dimensions"
                  value={values.dimensions}
                  inputMode="numeric"
                  aria-invalid={isManualDimensionsInvalid}
                  onChange={(event) =>
                    setValues((currentValues) => ({
                      ...currentValues,
                      dimensions: event.target.value.replace(/\D/g, '')
                    }))
                  }
                />
                {isManualDimensionsInvalid ? <FieldError>{t('knowledge.dimensions_error_invalid')}</FieldError> : null}
              </KnowledgeDialogField>
            ) : null}

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
