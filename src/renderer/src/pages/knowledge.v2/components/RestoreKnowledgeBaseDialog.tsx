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
import type { RestoreKnowledgeBaseInput } from '@renderer/hooks/useKnowledgeBases'
import { useModels } from '@renderer/hooks/useModels'
import type { KnowledgeSelectOption } from '@renderer/pages/knowledge.v2/types'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { MODEL_CAPABILITY } from '@shared/data/types/model'
import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import CreateKnowledgeBaseDialog, {
  formatKnowledgeModelOptionLabel,
  KNOWLEDGE_BASE_DEFAULT_DIMENSIONS
} from './CreateKnowledgeBaseDialog'

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
  const defaultName = t('knowledge_v2.restore.default_name', { name: base.name })
  const [values, setValues] = useState<RestoreKnowledgeBaseFormValues>(() =>
    createInitialValues(defaultName, initialEmbeddingModelId)
  )
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    setValues(createInitialValues(defaultName, initialEmbeddingModelId))
    setHasAttemptedSubmit(false)
    setSubmitError(null)
  }, [base.id, defaultName, initialEmbeddingModelId, open])

  const embeddingModelOptions: KnowledgeSelectOption[] = embeddingModels.map((model) => ({
    value: model.id,
    label: formatKnowledgeModelOptionLabel(model.id)
  }))

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setHasAttemptedSubmit(true)
    setSubmitError(null)

    if (!values.name.trim() || !values.embeddingModelId) {
      return
    }

    let restoredBase: KnowledgeBase

    try {
      restoredBase = await restoreBase({
        sourceBaseId: base.id,
        name: values.name,
        embeddingModelId: values.embeddingModelId,
        dimensions: initialDimensions ?? KNOWLEDGE_BASE_DEFAULT_DIMENSIONS
      })
    } catch {
      setSubmitError(t('knowledge_v2.restore.failed_to_restore'))
      return
    }

    onRestored(restoredBase)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 overflow-hidden rounded-2xl border-border/60 p-0">
        <CreateKnowledgeBaseDialog.Header title={t('knowledge_v2.restore.title')} />

        <CreateKnowledgeBaseDialog.Form onSubmit={handleSubmit}>
          <div className="space-y-3 px-4 py-3">
            <div className="space-y-1">
              <Label
                htmlFor="knowledge-v2-restore-name"
                className="font-medium text-[11px] text-muted-foreground leading-4">
                {t('common.name')}
              </Label>
              <Input
                id="knowledge-v2-restore-name"
                value={values.name}
                aria-invalid={hasAttemptedSubmit && !values.name.trim()}
                placeholder={t('common.name')}
                className="h-8 rounded-lg px-2.5 text-[11px] leading-4 placeholder:text-[11px] placeholder:text-muted-foreground/70"
                onChange={(event) => setValues((currentValues) => ({ ...currentValues, name: event.target.value }))}
              />
              {hasAttemptedSubmit && !values.name.trim() ? (
                <FieldError className="text-[11px] leading-4">{t('knowledge_v2.name_required')}</FieldError>
              ) : null}
            </div>

            <div className="space-y-1">
              <Label className="font-medium text-[11px] text-muted-foreground leading-4">
                {t('knowledge_v2.embedding_model')}
              </Label>
              <Select
                value={values.embeddingModelId ?? undefined}
                onValueChange={(embeddingModelId) =>
                  setValues((currentValues) => ({ ...currentValues, embeddingModelId }))
                }>
                <SelectTrigger
                  size="sm"
                  className="h-8 w-full rounded-lg px-2.5 text-[11px] leading-4 data-placeholder:text-[11px] data-placeholder:text-muted-foreground/70"
                  aria-invalid={hasAttemptedSubmit && !values.embeddingModelId}>
                  <SelectValue placeholder={t('knowledge_v2.not_set')} />
                </SelectTrigger>
                <SelectContent>
                  {embeddingModelOptions.length > 0 ? (
                    embeddingModelOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))
                  ) : (
                    <div className="px-2.5 py-2 text-[11px] text-muted-foreground">{t('knowledge_v2.not_set')}</div>
                  )}
                </SelectContent>
              </Select>
              {hasAttemptedSubmit && !values.embeddingModelId ? (
                <FieldError className="text-[11px] leading-4">{t('knowledge_v2.embedding_model_required')}</FieldError>
              ) : null}
            </div>

            {submitError ? <FieldError className="text-[11px] leading-4">{submitError}</FieldError> : null}
          </div>

          <CreateKnowledgeBaseDialog.Actions
            isCreating={isRestoring}
            onCancel={() => onOpenChange(false)}
            cancelLabel={t('common.cancel')}
            submitLabel={t('knowledge_v2.restore.submit')}
          />
        </CreateKnowledgeBaseDialog.Form>
      </DialogContent>
    </Dialog>
  )
}

export default RestoreKnowledgeBaseDialog
