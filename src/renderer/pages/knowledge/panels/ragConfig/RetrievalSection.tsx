import { useTranslation } from 'react-i18next'

import { RagSliderField } from './panelPrimitives'

interface RetrievalSectionProps {
  documentCount: number
  threshold: number
  rerankModelId: string | null
  onDocumentCountChange: (value: number) => void
  onThresholdChange: (value: number) => void
}

const RetrievalSection = ({
  documentCount,
  threshold,
  rerankModelId,
  onDocumentCountChange,
  onThresholdChange
}: RetrievalSectionProps) => {
  const { t } = useTranslation()
  const usesRelevanceThreshold = rerankModelId !== null

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
    </div>
  )
}

export default RetrievalSection
