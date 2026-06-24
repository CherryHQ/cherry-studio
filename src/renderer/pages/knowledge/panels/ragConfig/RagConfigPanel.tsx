import { Alert, Button, Scrollbar } from '@cherrystudio/ui'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { KnowledgeDialogFooter } from '../../components/KnowledgeDialogLayout'
import KnowledgePanelShell from '../../components/KnowledgePanelShell'
import { useKnowledgeRagConfig } from '../../hooks'
import { getKnowledgeBaseFailureReason, getKnowledgeRagConfigFormState } from '../../utils'
import ChunkingSection from './ChunkingSection'
import EmbeddingSection from './EmbeddingSection'
import FileProcessingSection from './FileProcessingSection'
import RetrievalSection from './RetrievalSection'

export interface KnowledgeRestoreBaseInitialValues {
  embeddingModelId?: string | null
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
  const { initialValues, fileProcessorOptions, searchModeOptions, save, isLoading } = useKnowledgeRagConfig(base)
  const [values, setValues] = useState(initialValues)

  useEffect(() => {
    setValues(initialValues)
  }, [initialValues])

  const formState = useMemo(() => getKnowledgeRagConfigFormState(initialValues, values), [initialValues, values])
  const { validationErrorCodes, isDirty, canSave } = formState
  // Changing the embedding model re-embeds existing content, so it routes through the
  // restore flow (which auto-detects the new model's dimensions) instead of a plain save.
  const embeddingModelChanged = values.embeddingModelId !== initialValues.embeddingModelId
  const canSubmit = canSave || embeddingModelChanged

  const handleSave = async () => {
    if (!canSubmit) {
      return
    }

    if (embeddingModelChanged) {
      onRestoreBase(base, { embeddingModelId: values.embeddingModelId })
      return
    }

    try {
      await save(values)
      window.toast.success(t('knowledge.rag.saved'))
    } catch (error) {
      window.toast.error(formatErrorMessageWithPrefix(error, t('knowledge.error.failed_to_edit')))
    }
  }

  const handleEmbeddingModelChange = (embeddingModelId: string | null) => {
    setValues((currentValues) => ({ ...currentValues, embeddingModelId }))
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
            chunkStrategy={values.chunkStrategy}
            chunkSeparator={values.chunkSeparator}
            chunkSize={values.chunkSize}
            chunkOverlap={values.chunkOverlap}
            chunkSizeErrorCode={validationErrorCodes.chunkSize}
            chunkOverlapErrorCode={validationErrorCodes.chunkOverlap}
            chunkSeparatorErrorCode={validationErrorCodes.chunkSeparator}
            onChunkStrategyChange={(chunkStrategy) =>
              setValues((currentValues) => ({ ...currentValues, chunkStrategy }))
            }
            onChunkSeparatorChange={(chunkSeparator) =>
              setValues((currentValues) => ({ ...currentValues, chunkSeparator }))
            }
            onChunkSizeChange={(chunkSize) =>
              setValues((currentValues) => ({ ...currentValues, chunkSize: chunkSize.replace(/\D/g, '') }))
            }
            onChunkOverlapChange={(chunkOverlap) =>
              setValues((currentValues) => ({ ...currentValues, chunkOverlap: chunkOverlap.replace(/\D/g, '') }))
            }
          />

          <EmbeddingSection
            embeddingModelId={values.embeddingModelId}
            onEmbeddingModelChange={handleEmbeddingModelChange}
          />

          <RetrievalSection
            searchModeOptions={searchModeOptions}
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
        <Button type="button" variant="emphasis" loading={isLoading} disabled={!canSubmit} onClick={handleSave}>
          {embeddingModelChanged ? t('knowledge.restore.submit') : t('knowledge.rag.save_action')}
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
