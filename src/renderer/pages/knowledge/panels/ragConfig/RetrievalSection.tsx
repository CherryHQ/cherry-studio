import type { KnowledgeSelectOption } from '@renderer/pages/knowledge/types'
import type { KnowledgeSearchMode } from '@shared/data/types/knowledge'
import { useTranslation } from 'react-i18next'

import { isRerankModel, KnowledgeModelSelect } from '../../components/KnowledgeModelSelect'
import { RagFieldLabel, RagSelectField, RagSliderField } from './panelPrimitives'

const DEFAULT_HYBRID_ALPHA = 0.5

interface RetrievalSectionProps {
  searchModeOptions: KnowledgeSelectOption[]
  documentCount: number
  threshold: number
  searchMode: KnowledgeSearchMode
  hybridAlpha: number | null
  rerankModelId: string | null
  onDocumentCountChange: (value: number) => void
  onThresholdChange: (value: number) => void
  onSearchModeChange: (value: KnowledgeSearchMode) => void
  onHybridAlphaChange: (value: number) => void
  onRerankModelChange: (value: string | null) => void
}

const RetrievalSection = ({
  searchModeOptions,
  documentCount,
  threshold,
  searchMode,
  hybridAlpha,
  rerankModelId,
  onDocumentCountChange,
  onThresholdChange,
  onSearchModeChange,
  onHybridAlphaChange,
  onRerankModelChange
}: RetrievalSectionProps) => {
  const { t } = useTranslation()
  const isHybridMode = searchMode === 'hybrid'
  const usesRelevanceThreshold = searchMode === 'vector' || rerankModelId !== null

  return (
    <div className="flex flex-col gap-4">
      <RagSliderField
        label={t('knowledge.rag.document_count')}
        hint={t('knowledge.rag.hints.document_count')}
        value={documentCount}
        onValueChange={onDocumentCountChange}
        min={1}
        max={50}
        step={1}
        minLabel="1"
        maxLabel="50"
        formatValue={(value) => String(value)}
      />

      {usesRelevanceThreshold ? (
        <RagSliderField
          label={t('knowledge.rag.threshold')}
          hint={t('knowledge.rag.hints.threshold')}
          value={threshold}
          onValueChange={onThresholdChange}
          min={0}
          max={1}
          step={0.1}
          minLabel="0.0"
          maxLabel="1.0"
          formatValue={(value) => value.toFixed(1)}
        />
      ) : null}

      <div>
        <RagFieldLabel label={t('knowledge.rag.search_mode.title')} hint={t('knowledge.rag.hints.search_mode')} />
        <RagSelectField
          value={searchMode}
          options={searchModeOptions}
          onValueChange={(value) => onSearchModeChange(value as KnowledgeSearchMode)}
        />
      </div>

      {isHybridMode ? (
        <RagSliderField
          label={t('knowledge.rag.hybrid_alpha')}
          hint={t('knowledge.rag.hints.hybrid_alpha')}
          value={hybridAlpha ?? DEFAULT_HYBRID_ALPHA}
          onValueChange={onHybridAlphaChange}
          min={0}
          max={1}
          step={0.1}
          minLabel="0.0"
          maxLabel="1.0"
          formatValue={(value) => value.toFixed(1)}
        />
      ) : null}

      <div>
        <RagFieldLabel label={t('knowledge.rag.rerank_model')} hint={t('knowledge.rag.hints.rerank_model')} />
        <KnowledgeModelSelect
          aria-label={t('knowledge.rag.rerank_model')}
          value={rerankModelId}
          placeholder={t('knowledge.rag.rerank_disabled')}
          filter={isRerankModel}
          allowClear
          clearAriaLabel={t('knowledge.rag.rerank_disabled')}
          onChange={onRerankModelChange}
        />
      </div>
    </div>
  )
}

export default RetrievalSection
