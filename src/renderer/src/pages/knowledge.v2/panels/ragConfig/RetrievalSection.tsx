import type { KnowledgeSelectOption } from '@renderer/pages/knowledge.v2/types'
import type { KnowledgeSearchMode } from '@shared/data/types/knowledge'
import { Search } from 'lucide-react'

import { RagFieldLabel, RagSectionTitle, RagSelectField, RagSliderField } from './panelPrimitives'

const EMPTY_OPTION_VALUE = '__none__'
const DEFAULT_HYBRID_ALPHA = 0.5

interface RetrievalSectionProps {
  title: string
  documentCountLabel: string
  thresholdLabel: string
  searchModeLabel: string
  hybridAlphaLabel: string
  rerankLabel: string
  notSetLabel: string
  searchModeOptions: KnowledgeSelectOption[]
  rerankModelOptions: KnowledgeSelectOption[]
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

const formatFloat = (value: number) => value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')

const RetrievalSection = ({
  title,
  documentCountLabel,
  thresholdLabel,
  searchModeLabel,
  hybridAlphaLabel,
  rerankLabel,
  notSetLabel,
  searchModeOptions,
  rerankModelOptions,
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
  const isHybridMode = searchMode === 'hybrid'

  return (
    <section className="space-y-2.5">
      <RagSectionTitle title={title} icon={Search} />

      <SliderField
        label={documentCountLabel}
        value={documentCount}
        onValueChange={onDocumentCountChange}
        min={1}
        max={50}
        step={1}
        minLabel="1"
        maxLabel="50"
        formatValue={(value) => String(value)}
      />

      <SliderField
        label={thresholdLabel}
        value={threshold}
        onValueChange={onThresholdChange}
        min={0}
        max={1}
        step={0.01}
        minLabel="0.00"
        maxLabel="1.00"
        formatValue={formatFloat}
      />

      <div>
        <RagFieldLabel label={searchModeLabel} />
        <RagSelectField
          value={searchMode}
          options={searchModeOptions}
          onValueChange={(value) => onSearchModeChange(value as KnowledgeSearchMode)}
        />
      </div>

      {isHybridMode ? (
        <RagSliderField
          label={hybridAlphaLabel}
          value={hybridAlpha ?? DEFAULT_HYBRID_ALPHA}
          onValueChange={onHybridAlphaChange}
          min={0}
          max={1}
          step={0.01}
          minLabel="0.00"
          maxLabel="1.00"
          formatValue={formatFloat}
        />
      ) : null}

      <div>
        <RagFieldLabel label={rerankLabel} />
        <RagSelectField
          value={rerankModelId ?? EMPTY_OPTION_VALUE}
          options={[{ value: EMPTY_OPTION_VALUE, label: notSetLabel }, ...rerankModelOptions]}
          onValueChange={(value) => onRerankModelChange(value === EMPTY_OPTION_VALUE ? null : value)}
        />
      </div>
    </section>
  )
}

const SliderField = RagSliderField

export default RetrievalSection
