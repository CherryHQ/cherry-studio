import { Button, Scrollbar } from '@cherrystudio/ui'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useKnowledgeV2RagConfig } from '../../hooks/useKnowledgeV2RagConfig'
import { useKnowledgeV2SaveRagConfig } from '../../hooks/useKnowledgeV2SaveRagConfig'
import type { KnowledgeV2RagConfigFormValues, KnowledgeV2SelectOption } from '../../types'
import ChunkingSection from './ChunkingSection'
import EmbeddingSection from './EmbeddingSection'
import PreprocessSection from './PreprocessSection'
import RetrievalSection from './RetrievalSection'

interface RagConfigPanelProps {
  base: KnowledgeBase
}

const sanitizeIntegerInput = (value: string) => value.replace(/\D/g, '')

const parseInteger = (value: string) => {
  if (!value) {
    return null
  }

  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : null
}

const RagConfigPanel = ({ base }: RagConfigPanelProps) => {
  const { t } = useTranslation()
  const { initialValues, fileProcessorOptions, embeddingModelOptions, rerankModelOptions } =
    useKnowledgeV2RagConfig(base)
  const { save, isLoading } = useKnowledgeV2SaveRagConfig(base)
  const [values, setValues] = useState(initialValues)

  useEffect(() => {
    setValues(initialValues)
  }, [initialValues])

  const searchModeOptions = useMemo<KnowledgeV2SelectOption[]>(
    () => [
      { value: 'hybrid', label: t('knowledge_v2.rag.search_mode.hybrid') },
      { value: 'default', label: t('knowledge_v2.rag.search_mode.default') },
      { value: 'bm25', label: t('knowledge_v2.rag.search_mode.bm25') }
    ],
    [t]
  )

  const validationErrors = useMemo(() => {
    const chunkSize = parseInteger(values.chunkSize)
    const chunkOverlap = parseInteger(values.chunkOverlap)
    const errors: { chunkSize?: string; chunkOverlap?: string } = {}

    if (values.chunkSize && (!chunkSize || chunkSize <= 0)) {
      errors.chunkSize = t('knowledge_v2.rag.chunk_size_invalid')
    }

    if (values.chunkOverlap && (chunkOverlap == null || chunkOverlap < 0)) {
      errors.chunkOverlap = t('knowledge_v2.rag.chunk_overlap_invalid')
    }

    if (chunkSize != null && chunkOverlap != null && chunkOverlap >= chunkSize) {
      errors.chunkOverlap = t('knowledge_v2.rag.chunk_overlap_must_be_smaller')
    }

    return errors
  }, [t, values.chunkOverlap, values.chunkSize])

  const isDirty = JSON.stringify(values) !== JSON.stringify(initialValues)
  const hasEmptyChunkFields = values.chunkSize === '' || values.chunkOverlap === ''
  const hasValidationErrors = Object.values(validationErrors).some(Boolean)

  const updateValues = (patch: Partial<KnowledgeV2RagConfigFormValues>) => {
    setValues((currentValues) => ({ ...currentValues, ...patch }))
  }

  const handleSave = async () => {
    if (!isDirty || hasEmptyChunkFields || hasValidationErrors) {
      return
    }

    try {
      await save(values)
      window.toast.success(t('common.saved'))
    } catch {
      window.toast.error(t('knowledge.error.failed_to_edit'))
    }
  }

  return (
    <Scrollbar className="h-full min-h-0">
      <div className="mx-auto max-w-[30rem] space-y-5 px-5 py-4">
        <PreprocessSection
          title={t('knowledge.settings.preprocessing')}
          fileProcessorId={values.fileProcessorId}
          fileProcessorOptions={fileProcessorOptions}
          notSetLabel={t('knowledge.not_set')}
          processorLabel={t('knowledge_v2.rag.processor')}
          preprocessingHint={t('knowledge_v2.rag.preprocessing_hint')}
          onFileProcessorChange={(fileProcessorId) => updateValues({ fileProcessorId })}
        />

        <ChunkingSection
          title={t('knowledge_v2.rag.chunking')}
          chunkSizeLabel={t('knowledge.chunk_size')}
          chunkOverlapLabel={t('knowledge.chunk_overlap')}
          tokensUnitLabel={t('knowledge_v2.rag.tokens_unit')}
          warningText={t('knowledge.chunk_size_change_warning')}
          chunkSize={values.chunkSize}
          chunkOverlap={values.chunkOverlap}
          chunkSizeError={validationErrors.chunkSize}
          chunkOverlapError={validationErrors.chunkOverlap}
          onChunkSizeChange={(chunkSize) => updateValues({ chunkSize: sanitizeIntegerInput(chunkSize) })}
          onChunkOverlapChange={(chunkOverlap) => updateValues({ chunkOverlap: sanitizeIntegerInput(chunkOverlap) })}
        />

        <EmbeddingSection
          title={t('knowledge.embedding_model')}
          embeddingLabel={t('knowledge.embedding_model')}
          dimensionsLabel={t('knowledge.dimensions')}
          placeholderLabel={t('knowledge.not_set')}
          embeddingModelId={values.embeddingModelId}
          embeddingModelOptions={embeddingModelOptions}
          dimensions={values.dimensions}
          onEmbeddingModelChange={(embeddingModelId) => updateValues({ embeddingModelId })}
        />

        <RetrievalSection
          title={t('knowledge_v2.rag.retrieval')}
          documentCountLabel={t('knowledge.document_count')}
          thresholdLabel={t('knowledge.threshold')}
          searchModeLabel={t('knowledge_v2.rag.search_mode.title')}
          hybridAlphaLabel={t('knowledge_v2.rag.hybrid_alpha')}
          rerankLabel={t('models.rerank_model')}
          notSetLabel={t('knowledge.not_set')}
          searchModeOptions={searchModeOptions}
          rerankModelOptions={rerankModelOptions}
          documentCount={values.documentCount}
          threshold={values.threshold}
          searchMode={values.searchMode}
          hybridAlpha={values.hybridAlpha}
          rerankModelId={values.rerankModelId}
          onDocumentCountChange={(documentCount) => updateValues({ documentCount })}
          onThresholdChange={(threshold) => updateValues({ threshold })}
          onSearchModeChange={(searchMode) => updateValues({ searchMode })}
          onHybridAlphaChange={(hybridAlpha) => updateValues({ hybridAlpha })}
          onRerankModelChange={(rerankModelId) => updateValues({ rerankModelId })}
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
            disabled={!isDirty || hasEmptyChunkFields || hasValidationErrors}
            className="h-6 min-h-6 rounded-md bg-emerald-400 px-3 text-[0.6875rem] text-white leading-4.125 shadow-none hover:bg-emerald-500"
            onClick={handleSave}>
            {t('common.save')}
          </Button>
        </div>
      </div>
    </Scrollbar>
  )
}

export default RagConfigPanel
