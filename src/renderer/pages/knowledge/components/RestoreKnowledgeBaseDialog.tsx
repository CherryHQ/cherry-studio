import { Dialog, DialogContent, FieldError, Input, Label } from '@cherrystudio/ui'
import type { RestoreKnowledgeBaseInput } from '@renderer/hooks/useKnowledgeBases'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import CreateKnowledgeBaseDialog, { KNOWLEDGE_BASE_DEFAULT_DIMENSIONS } from './CreateKnowledgeBaseDialog'
import { isEmbeddingModel, KnowledgeModelSelectField } from './KnowledgeModelSelectField'

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
  const defaultName = t('knowledge.restore.default_name', { name: base.name })
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
    } catch (error) {
      setSubmitError(formatErrorMessageWithPrefix(error, t('knowledge.restore.failed_to_restore')))
      return
    }

    onRestored(restoredBase)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 overflow-hidden rounded-2xl border-border/60 p-0">
        <CreateKnowledgeBaseDialog.Header title={t('knowledge.restore.title')} />

        <CreateKnowledgeBaseDialog.Form onSubmit={handleSubmit}>
          <div className="space-y-3 px-4 py-3">
            <div className="space-y-1">
              <Label htmlFor="knowledge-restore-name" className="text-muted-foreground leading-4">
                {t('common.name')}
              </Label>
              <Input
                id="knowledge-restore-name"
                value={values.name}
                aria-invalid={hasAttemptedSubmit && !values.name.trim()}
                placeholder={t('common.name')}
                className="h-8 rounded-lg px-2.5 leading-4 placeholder:text-muted-foreground/70"
                onChange={(event) => setValues((currentValues) => ({ ...currentValues, name: event.target.value }))}
              />
              {hasAttemptedSubmit && !values.name.trim() ? (
                <FieldError className="leading-4">{t('knowledge.name_required')}</FieldError>
              ) : null}
            </div>

            <div className="space-y-1">
              <Label className="text-muted-foreground leading-4">{t('knowledge.embedding_model')}</Label>
              <KnowledgeModelSelectField
                value={values.embeddingModelId}
                filter={isEmbeddingModel}
                placeholder={t('knowledge.not_set')}
                invalid={hasAttemptedSubmit && !values.embeddingModelId}
                triggerClassName="h-8 rounded-lg border-border/40 bg-transparent px-2.5 leading-4 hover:bg-muted/20"
                onValueChange={(embeddingModelId) =>
                  setValues((currentValues) => ({ ...currentValues, embeddingModelId }))
                }
              />
              {hasAttemptedSubmit && !values.embeddingModelId ? (
                <FieldError className="leading-4">{t('knowledge.embedding_model_required')}</FieldError>
              ) : null}
            </div>

            {submitError ? <FieldError className="leading-4">{submitError}</FieldError> : null}
          </div>

          <CreateKnowledgeBaseDialog.Actions
            isCreating={isRestoring}
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
