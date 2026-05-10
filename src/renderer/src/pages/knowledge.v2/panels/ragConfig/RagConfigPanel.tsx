import { Button, Scrollbar } from '@cherrystudio/ui'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useKnowledgeRagConfig } from '../../hooks'
import { getKnowledgeBaseFailureReason, getKnowledgeRagConfigFormState, parseRequiredInteger } from '../../utils'
import ChunkingSection from './ChunkingSection'
import EmbeddingSection from './EmbeddingSection'
import FileProcessingSection from './FileProcessingSection'
import RetrievalSection from './RetrievalSection'

const RAG_SECTION_DIVIDER = <div className="border-border/15 border-t" />

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
          <div className="font-medium text-destructive text-sm leading-4">{t('knowledge_v2.status.failed')}</div>
          <p className="mt-1 text-muted-foreground text-sm leading-4">{failureReason}</p>
          <Button
            type="button"
            className="mt-3 h-6 min-h-6 rounded-md bg-primary px-3 text-primary-foreground text-sm leading-5 shadow-none hover:bg-primary/90"
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
      window.toast.success(t('knowledge_v2.rag.saved'))
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

        {RAG_SECTION_DIVIDER}

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

        {RAG_SECTION_DIVIDER}

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

        {RAG_SECTION_DIVIDER}

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
            className="h-8 min-h-8 rounded-xl px-3 text-muted-foreground text-sm leading-5 shadow-none hover:bg-accent hover:text-foreground"
            onClick={() => setValues(initialValues)}>
            <RotateCcw className="size-3.5" />
            {t('knowledge_v2.rag.reset_action')}
          </Button>
          <Button
            type="button"
            variant="default"
            loading={isLoading}
            disabled={!canSave}
            className="h-8 min-h-8 rounded-xl px-6 text-sm leading-5 shadow-none"
            onClick={handleSave}>
            {embeddingConfigChanged ? t('knowledge_v2.restore.submit') : t('knowledge_v2.rag.save_action')}
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
