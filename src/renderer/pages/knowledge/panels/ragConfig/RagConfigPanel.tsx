import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Alert,
  Button,
  Scrollbar
} from '@cherrystudio/ui'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { DEFAULT_KNOWLEDGE_SEARCH_MODE, type KnowledgeBase } from '@shared/data/types/knowledge'
import { RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { KnowledgeDialogFooter } from '../../components/KnowledgeDialogLayout'
import KnowledgePanelShell from '../../components/KnowledgePanelShell'
import { useEmbeddingDimensions, useKnowledgeRagConfig } from '../../hooks'
import { getKnowledgeBaseFailureReason } from '../../utils/error'
import { buildKnowledgeSearchModeOptions } from '../../utils/rag'
import { getKnowledgeRagConfigFormState } from '../../utils/validate'
import ChunkingSection from './ChunkingSection'
import EmbeddingSection from './EmbeddingSection'
import FileProcessingSection from './FileProcessingSection'
import RerankSection from './RerankSection'
import RetrievalSection from './RetrievalSection'

export interface KnowledgeRestoreBaseInitialValues {
  embeddingModelId?: string | null
}

interface RagConfigPanelProps {
  base: KnowledgeBase
  // Undefined means unknown (e.g. items are still loading) and is treated as
  // "not empty" so the safer restore flow is offered until it is confirmed 0.
  itemCount?: number
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

const ActiveRagConfigPanel = ({ base, itemCount, onRestoreBase }: RagConfigPanelProps) => {
  const { t } = useTranslation()
  const { initialValues, fileProcessorOptions, save, isLoading } = useKnowledgeRagConfig(base)
  const { fetchDimensions, isFetchingDimensions } = useEmbeddingDimensions()
  const [values, setValues] = useState(initialValues)

  useEffect(() => {
    setValues(initialValues)
  }, [initialValues])

  // Keyed on the pending form value (not the persisted base) so picking a model and a
  // search mode in the same edit works instead of only offering bm25 until the restore
  // this triggers completes.
  const searchModeOptions = useMemo(
    () => buildKnowledgeSearchModeOptions(values.embeddingModelId, t),
    [t, values.embeddingModelId]
  )
  const formState = useMemo(() => getKnowledgeRagConfigFormState(initialValues, values), [initialValues, values])
  const { validationErrorCodes, isDirty, canSave } = formState
  const embeddingModelChanged = values.embeddingModelId !== initialValues.embeddingModelId
  // Changing the embedding model re-embeds existing content, so it normally routes
  // through the restore flow (which auto-detects the new model's dimensions) instead
  // of a plain save. A base with no items yet has nothing to re-embed, so the change
  // can be saved in place — itemCount is undefined while unknown/loading, which is
  // treated as "not empty" so the safer restore flow stays the default.
  const canSaveEmbeddingModelDirectly = embeddingModelChanged && itemCount === 0
  const requiresRestore = embeddingModelChanged && !canSaveEmbeddingModelDirectly
  // Restore only ever reads embeddingModelId (it ignores the rest of the dirty
  // draft), so it can bypass canSave the way it always could. A direct save
  // re-submits the whole dirty form, including chunk fields, so it must respect
  // the same chunk validation as a plain save.
  const canSubmit = canSave || requiresRestore

  const handleSave = async () => {
    if (!canSubmit) {
      return
    }

    if (requiresRestore) {
      onRestoreBase(base, { embeddingModelId: values.embeddingModelId })
      return
    }

    if (canSaveEmbeddingModelDirectly) {
      let dimensions: number | null = null

      if (values.embeddingModelId) {
        try {
          dimensions = await fetchDimensions(values.embeddingModelId)
        } catch (error) {
          window.toast.error(formatErrorMessageWithPrefix(error, t('message.error.get_embedding_dimensions')))
          return
        }
      }

      try {
        const saveValues =
          initialValues.embeddingModelId === null &&
          values.embeddingModelId !== null &&
          values.searchMode === initialValues.searchMode
            ? { ...values, searchMode: DEFAULT_KNOWLEDGE_SEARCH_MODE, hybridAlpha: null }
            : values

        await save(saveValues, { embeddingModelId: values.embeddingModelId, dimensions })
        window.toast.success(t('knowledge.rag.saved'))
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('knowledge.error.failed_to_edit')))
      }
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

          <EmbeddingSection
            embeddingModelId={values.embeddingModelId}
            onEmbeddingModelChange={handleEmbeddingModelChange}
          />

          <RerankSection
            rerankModelId={values.rerankModelId}
            onRerankModelChange={(rerankModelId) => setValues((currentValues) => ({ ...currentValues, rerankModelId }))}
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
          />

          {/* Chunking knobs are set-and-forget internals, so they live under a
              collapsed "Advanced" section to keep the essentials on top. */}
          <Accordion type="single" collapsible>
            <AccordionItem value="advanced" className="border-border-subtle last:border-b">
              <AccordionTrigger>{t('common.advanced_settings')}</AccordionTrigger>
              <AccordionContent className="flex flex-col gap-4">
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
              </AccordionContent>
            </AccordionItem>
          </Accordion>
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
        <Button
          type="button"
          variant="emphasis"
          loading={isLoading || isFetchingDimensions}
          disabled={!canSubmit}
          onClick={handleSave}>
          {requiresRestore ? t('knowledge.restore.submit') : t('knowledge.rag.save_action')}
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
