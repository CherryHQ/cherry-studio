import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Alert,
  Button,
  Scrollbar
} from '@cherrystudio/ui'
import { useEnableKnowledgeBaseEmbedding } from '@renderer/hooks/useKnowledgeBase'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { KnowledgeDialogFooter } from '../../components/KnowledgeDialogLayout'
import KnowledgePanelShell from '../../components/KnowledgePanelShell'
import { useEmbeddingDimensions } from '../../hooks/useEmbeddingDimensions'
import { useKnowledgeRagConfig } from '../../hooks/useKnowledgeRagConfig'
import { getKnowledgeBaseFailureReason } from '../../utils/error'
import { buildKnowledgeRagConfigPatch } from '../../utils/rag'
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

type EmbeddingModelChangeRoute = 'save-directly' | 'enable-in-place' | 'restore'

// Shared by the Save button's gating and the submit executor so they can never
// disagree on which route a given (itemCount, previous model) pair takes.
// - A base with no items has nothing to re-embed, so the change saves in place.
// - A BM25-only base (no prior model) gaining a model has no vectors to invalidate
//   either, so it can be backfilled in place instead of restored into a new base.
// - Anything else (switching an already-configured model) invalidates existing
//   vectors and must go through restore. itemCount undefined (unknown/loading)
//   is treated as "not empty", keeping restore as the safe default.
const resolveEmbeddingModelChangeRoute = (
  itemCount: number | undefined,
  previousEmbeddingModelId: string | null
): EmbeddingModelChangeRoute => {
  if (itemCount === 0) {
    return 'save-directly'
  }
  if (previousEmbeddingModelId === null && typeof itemCount === 'number' && itemCount > 0) {
    return 'enable-in-place'
  }
  return 'restore'
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
  const { enableEmbedding, isEnabling } = useEnableKnowledgeBaseEmbedding()
  const [values, setValues] = useState(initialValues)

  useEffect(() => {
    setValues(initialValues)
  }, [initialValues])

  const formState = useMemo(() => getKnowledgeRagConfigFormState(initialValues, values), [initialValues, values])
  const { validationErrorCodes, isDirty, canSave } = formState
  const embeddingModelChanged = values.embeddingModelId !== initialValues.embeddingModelId
  const embeddingModelChangeRoute = embeddingModelChanged
    ? resolveEmbeddingModelChangeRoute(itemCount, initialValues.embeddingModelId)
    : null
  const canEnableEmbeddingInPlace = embeddingModelChangeRoute === 'enable-in-place'
  const requiresRestore = embeddingModelChangeRoute === 'restore'
  // Restore only ever reads embeddingModelId (it ignores the rest of the dirty
  // draft), so it can bypass canSave the way it always could. The other two routes
  // re-submit the whole dirty form, including chunk fields, so they must respect
  // the same chunk validation as a plain save.
  const canSubmit = canSave || requiresRestore || canEnableEmbeddingInPlace

  // Shared submit executor, parameterized by the draft to persist so the download
  // auto-save can pass its freshly-selected values without waiting for a setValues
  // re-render. The routing is derived from `submitValues`, mirroring the
  // render-level computations that gate the Save button.
  const persist = async (submitValues: typeof values) => {
    const modelChanged = submitValues.embeddingModelId !== initialValues.embeddingModelId

    if (!modelChanged) {
      try {
        await save(submitValues)
        toast.success(t('knowledge.rag.saved'))
      } catch (error) {
        toast.error(formatErrorMessageWithPrefix(error, t('knowledge.error.failed_to_edit')))
      }
      return
    }

    const route = resolveEmbeddingModelChangeRoute(itemCount, initialValues.embeddingModelId)

    if (route === 'restore') {
      onRestoreBase(base, { embeddingModelId: submitValues.embeddingModelId })
      return
    }

    let dimensions: number | null = null
    if (submitValues.embeddingModelId) {
      try {
        dimensions = await fetchDimensions(submitValues.embeddingModelId)
      } catch (error) {
        toast.error(formatErrorMessageWithPrefix(error, t('message.error.get_embedding_dimensions')))
        return
      }
    }

    if (route === 'enable-in-place') {
      try {
        const patch = buildKnowledgeRagConfigPatch(initialValues, submitValues)
        await enableEmbedding(base.id, { ...patch, embeddingModelId: submitValues.embeddingModelId, dimensions })
        toast.success(t('knowledge.rag.saved'))
      } catch (error) {
        toast.error(formatErrorMessageWithPrefix(error, t('knowledge.error.failed_to_edit')))
      }
      return
    }

    try {
      await save(submitValues, { embeddingModelId: submitValues.embeddingModelId, dimensions })
      toast.success(t('knowledge.rag.saved'))
    } catch (error) {
      toast.error(formatErrorMessageWithPrefix(error, t('knowledge.error.failed_to_edit')))
    }
  }

  const handleSave = () => {
    if (!canSubmit) {
      return
    }
    return persist(values)
  }

  const handleEmbeddingModelChange = (embeddingModelId: string | null) => {
    setValues((currentValues) => ({ ...currentValues, embeddingModelId }))
  }

  // A finished local-model download selects the model in the draft AND persists it
  // straight away, so the user doesn't have to click Save. Persist the freshly
  // selected values directly (setValues is async) and mirror the Save button's gate.
  // Only the restore route bypasses canSave — it only ever reads embeddingModelId, so
  // an invalid chunk field elsewhere in the draft doesn't block it. The enable-in-place
  // route submits the whole draft like a plain save, so it stays behind nextCanSave too.
  const handleLocalEmbeddingDownloaded = (embeddingModelId: string) => {
    const nextValues = { ...values, embeddingModelId }
    setValues(nextValues)

    const modelChanged = embeddingModelId !== initialValues.embeddingModelId
    const nextRequiresRestore =
      modelChanged && resolveEmbeddingModelChangeRoute(itemCount, initialValues.embeddingModelId) === 'restore'
    const { canSave: nextCanSave } = getKnowledgeRagConfigFormState(initialValues, nextValues)
    if (nextCanSave || nextRequiresRestore) {
      void persist(nextValues)
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

          <EmbeddingSection
            embeddingModelId={values.embeddingModelId}
            onEmbeddingModelChange={handleEmbeddingModelChange}
            onLocalEmbeddingDownloaded={handleLocalEmbeddingDownloaded}
          />

          <RerankSection
            rerankModelId={values.rerankModelId}
            onRerankModelChange={(rerankModelId) => setValues((currentValues) => ({ ...currentValues, rerankModelId }))}
          />

          <RetrievalSection
            documentCount={values.documentCount}
            threshold={values.threshold}
            rerankModelId={values.rerankModelId}
            onDocumentCountChange={(documentCount) =>
              setValues((currentValues) => ({ ...currentValues, documentCount }))
            }
            onThresholdChange={(threshold) => setValues((currentValues) => ({ ...currentValues, threshold }))}
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
          loading={isLoading || isFetchingDimensions || isEnabling}
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
