import { useTranslation } from 'react-i18next'

import { RagSliderField } from './panelPrimitives'

interface RetrievalSectionProps {
  documentCount: number
  onDocumentCountChange: (value: number) => void
}

const RetrievalSection = ({ documentCount, onDocumentCountChange }: RetrievalSectionProps) => {
  const { t } = useTranslation()

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
    </div>
  )
}

export default RetrievalSection
