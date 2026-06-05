import { Alert, Button, Scrollbar } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { formatErrorMessageWithPrefix, getErrorMessage } from '@renderer/utils/error'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { KnowledgeDialogFooter } from '../../components/KnowledgeDialogLayout'
import KnowledgePanelShell from '../../components/KnowledgePanelShell'
import { useKnowledgeRagConfig } from '../../hooks'
import { getKnowledgeBaseFailureReason, getKnowledgeRagConfigFormState, parseRequiredInteger } from '../../utils'
import ChunkingSection from './ChunkingSection'
import EmbeddingSection from './EmbeddingSection'
import FileProcessingSection from './FileProcessingSection'
import RetrievalSection from './RetrievalSection'

const logger = loggerService.withContext('RagConfigPanel')

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
        <Alert
          type="error"
          message={t('knowledge.status.failed')}
          description={failureReason}
          data-testid="rag-failed-state"
          action={
            <Button type="button" size="sm" onClick={() => onRestoreBase(base)}>
              {t('knowledge.restore.action')}
            </Button>
          }
        />
      </div>
    </Scrollbar>
  )
}

const ActiveRagConfigPanel = ({ base, onRestoreBase }: RagConfigPanelProps) => {
  const { t } = useTranslation()
  const {
    initialValues,
    embeddingModels,
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
  const selectedEmbeddingModel = useMemo(
    () => embeddingModels.find((model) => model.id === values.embeddingModelId),
    [embeddingModels, values.embeddingModelId]
  )
  const [isFetchingDimensions, setIsFetchingDimensions] = useState(false)
  const embeddingConfigChanged =
    values.embeddingModelId !== initialValues.embeddingModelId || values.dimensions !== initialValues.dimensions

  const handleRefreshDimensions = async () => {
    if (!selectedEmbeddingModel) {
      window.toast.error(t('knowledge.embedding_model_required'))
      return
    }

    setIsFetchingDimensions(true)
    try {
      const { embeddings } = await window.api.ai.embedMany({
        uniqueModelId: selectedEmbeddingModel.id,
        values: ['test']
      })
      const dimensions = embeddings[0].length
      setValues((currentValues) => ({ ...currentValues, dimensions: dimensions.toString() }))
    } catch (error) {
      logger.error(t('message.error.get_embedding_dimensions'), error as Error)
      window.toast.error(t('message.error.get_embedding_dimensions') + '\n' + getErrorMessage(error))
    } finally {
      setIsFetchingDimensions(false)
    }
  }

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
      window.toast.success(t('knowledge.rag.saved'))
    } catch (error) {
      window.toast.error(formatErrorMessageWithPrefix(error, t('knowledge.error.failed_to_edit')))
    }
  }

  return (
    <KnowledgePanelShell>
      <Scrollbar className="min-h-0 flex-1 px-6 py-5">
        <div className="flex flex-col gap-4">
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
            embeddingModel={selectedEmbeddingModel}
            embeddingModelOptions={embeddingModelOptions}
            dimensions={values.dimensions}
            dimensionsErrorCode={validationErrorCodes.dimensions}
            isFetchingDimensions={isFetchingDimensions}
            onEmbeddingModelChange={(embeddingModelId) =>
              setValues((currentValues) => ({ ...currentValues, embeddingModelId }))
            }
            onDimensionsChange={(dimensions) =>
              setValues((currentValues) => ({ ...currentValues, dimensions: dimensions.replace(/\D/g, '') }))
            }
            onRefreshDimensions={handleRefreshDimensions}
          />

          <RetrievalSection
            searchModeOptions={searchModeOptions}
            rerankModelOptions={rerankModelOptions}
            documentCount={values.documentCount}
            threshold={values.threshold}
            searchMode={values.searchMode}
            hybridAlpha={values.hybridAlpha}
            rerankModelId={values.rerankModelId}
            onDocumentCountChange={(documentCount) =>
              setValues((currentValues) => ({ ...currentValues, documentCount }))
            }
            onThresholdChange={(threshold) => setValues((currentValues) => ({ ...currentValues, threshold }))}
            onSearchModeChange={(searchMode) => setValues((currentValues) => ({ ...currentValues, searchMode }))}
            onHybridAlphaChange={(hybridAlpha) => setValues((currentValues) => ({ ...currentValues, hybridAlpha }))}
            onRerankModelChange={(rerankModelId) => setValues((currentValues) => ({ ...currentValues, rerankModelId }))}
          />
        </div>
      </Scrollbar>

      <KnowledgeDialogFooter className="shrink-0 border-border-subtle border-t px-6 py-4">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!isDirty || isLoading}
          className="mr-auto text-foreground-muted hover:text-foreground"
          onClick={() => setValues(initialValues)}>
          <RotateCcw />
          {t('knowledge.rag.reset_action')}
        </Button>
        <Button type="button" variant="emphasis" loading={isLoading} disabled={!canSave} onClick={handleSave}>
          {embeddingConfigChanged ? t('knowledge.restore.submit') : t('knowledge.rag.save_action')}
        </Button>
      </KnowledgeDialogFooter>
    </KnowledgePanelShell>
  )
}

const RagConfigPanel = (props: RagConfigPanelProps) => {
  if (props.base.status === 'failed') {
    return <FailedRagConfigPanel {...props} />
  }

  return <ActiveRagConfigPanel {...props} />
}

export default RagConfigPanel
