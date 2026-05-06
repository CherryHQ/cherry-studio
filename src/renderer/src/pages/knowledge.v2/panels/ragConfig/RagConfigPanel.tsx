import { Button, Scrollbar } from '@cherrystudio/ui'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useKnowledgeRagConfig } from '../../hooks'
import { getKnowledgeBaseFailureReason, getKnowledgeRagConfigFormState, parseRequiredInteger } from '../../utils'
import ChunkingSection from './ChunkingSection'
import EmbeddingSection from './EmbeddingSection'
import FileProcessingSection from './FileProcessingSection'
import RetrievalSection from './RetrievalSection'

export interface KnowledgeRestoreBaseInitialValues {
  embeddingModelId?: string | null
  dimensions?: number | null
}

interface RagConfigPanelProps {
  base: KnowledgeBase
  onRestoreBase: (base: KnowledgeBase, initialValues?: KnowledgeRestoreBaseInitialValues) => void
}

const FailedRagConfigPanel = ({ base, onRestoreBase }: RagConfigPanelProps) => {
  const { t } = useTranslation()
  const failureReason = getKnowledgeBaseFailureReason(base, t)

  return (
    <Scrollbar className="flex h-full min-h-0 items-center justify-center">
      <div className="w-full max-w-120 px-5 py-4">
        <div
          className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3"
          data-testid="rag-failed-state">
          <div className="text-[0.6875rem] font-medium text-destructive leading-4">
            {t('knowledge_v2.status.failed')}
          </div>
          <p className="mt-1 text-[0.6875rem] text-muted-foreground leading-4">{failureReason}</p>
          <Button
            type="button"
            className="mt-3 h-6 min-h-6 rounded-md bg-primary px-3 text-[0.6875rem] text-primary-foreground leading-4.125 shadow-none hover:bg-primary/90"
            onClick={() => onRestoreBase(base)}>
            {t('knowledge_v2.restore.action')}
          </Button>
        </div>
      </div>
    </Scrollbar>
  )
}

const ActiveRagConfigPanel = ({ base, onRestoreBase }: RagConfigPanelProps) => {
  const { t } = useTranslation()
  const {
    initialValues,
    fileProcessorOptions,
    embeddingModelOptions,
    rerankModelOptions,
    searchModeOptions,
    save,
    isLoading
  } = useKnowledgeRagConfig(base)
  const [values, setValues] = useState(initialValues)

  useEffect(() => {
    setValues(initialValues)
  }, [initialValues])

  const formState = useMemo(() => getKnowledgeRagConfigFormState(initialValues, values), [initialValues, values])
  const { validationErrorCodes, isDirty, canSave } = formState
  const embeddingConfigChanged =
    values.embeddingModelId !== initialValues.embeddingModelId || values.dimensions !== initialValues.dimensions

  const handleSave = async () => {
    if (!canSave) {
      return
    }

    if (embeddingConfigChanged) {
      onRestoreBase(base, {
        embeddingModelId: values.embeddingModelId,
        dimensions: parseRequiredInteger(values.dimensions)
      })
      return
    }

    try {
      await save(values)
      window.toast.success(t('common.saved'))
    } catch {
      window.toast.error(t('knowledge_v2.error.failed_to_edit'))
    }
  }

  return (
    <Scrollbar className="h-full min-h-0">
      <div className="mx-auto max-w-120 space-y-5 px-5 py-4">
        <FileProcessingSection
          fileProcessorId={values.fileProcessorId}
          fileProcessorOptions={fileProcessorOptions}
          onFileProcessorChange={(fileProcessorId) =>
            setValues((currentValues) => ({ ...currentValues, fileProcessorId }))
          }
        />

        <ChunkingSection
          chunkSize={values.chunkSize}
          chunkOverlap={values.chunkOverlap}
          chunkSizeErrorCode={validationErrorCodes.chunkSize}
          chunkOverlapErrorCode={validationErrorCodes.chunkOverlap}
          onChunkSizeChange={(chunkSize) =>
            setValues((currentValues) => ({ ...currentValues, chunkSize: chunkSize.replace(/\D/g, '') }))
          }
          onChunkOverlapChange={(chunkOverlap) =>
            setValues((currentValues) => ({ ...currentValues, chunkOverlap: chunkOverlap.replace(/\D/g, '') }))
          }
        />

        <EmbeddingSection
          embeddingModelId={values.embeddingModelId}
          embeddingModelOptions={embeddingModelOptions}
          dimensions={values.dimensions}
          dimensionsErrorCode={validationErrorCodes.dimensions}
          onEmbeddingModelChange={(embeddingModelId) =>
            setValues((currentValues) => ({ ...currentValues, embeddingModelId }))
          }
          onDimensionsChange={(dimensions) =>
            setValues((currentValues) => ({ ...currentValues, dimensions: dimensions.replace(/\D/g, '') }))
          }
        />

        <RetrievalSection
          searchModeOptions={searchModeOptions}
          rerankModelOptions={rerankModelOptions}
          documentCount={values.documentCount}
          threshold={values.threshold}
          searchMode={values.searchMode}
          hybridAlpha={values.hybridAlpha}
          rerankModelId={values.rerankModelId}
          onDocumentCountChange={(documentCount) => setValues((currentValues) => ({ ...currentValues, documentCount }))}
          onThresholdChange={(threshold) => setValues((currentValues) => ({ ...currentValues, threshold }))}
          onSearchModeChange={(searchMode) => setValues((currentValues) => ({ ...currentValues, searchMode }))}
          onHybridAlphaChange={(hybridAlpha) => setValues((currentValues) => ({ ...currentValues, hybridAlpha }))}
          onRerankModelChange={(rerankModelId) => setValues((currentValues) => ({ ...currentValues, rerankModelId }))}
        />

        <div className="flex items-center justify-end gap-2 border-border/15 border-t pt-3">
          <Button
            type="button"
            variant="ghost"
            disabled={!isDirty || isLoading}
            className="h-6 min-h-6 rounded-md px-3 text-[0.6875rem] text-muted-foreground/50 leading-4.125 shadow-none hover:bg-accent/60 hover:text-foreground"
            onClick={() => setValues(initialValues)}>
            {t('common.reset')}
          </Button>
          <Button
            type="button"
            loading={isLoading}
            disabled={!canSave}
            className="h-6 min-h-6 rounded-md bg-emerald-400 px-3 text-[0.6875rem] text-white leading-4.125 shadow-none hover:bg-emerald-500"
            onClick={handleSave}>
            {embeddingConfigChanged ? t('knowledge_v2.restore.submit') : t('common.save')}
          </Button>
        </div>
      </div>
    </Scrollbar>
  )
}

const RagConfigPanel = (props: RagConfigPanelProps) => {
  if (props.base.status === 'failed') {
    return <FailedRagConfigPanel {...props} />
  }

  return <ActiveRagConfigPanel {...props} />
}

export default RagConfigPanel
