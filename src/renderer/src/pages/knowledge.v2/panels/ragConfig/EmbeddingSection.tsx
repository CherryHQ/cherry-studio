import { DatabaseZap } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { KnowledgeSelectOption } from '../../types'
import { RagFieldLabel, RagNumericField, RagSectionTitle, RagSelectField } from './panelPrimitives'

interface EmbeddingSectionProps {
  embeddingModelId: string | null
  embeddingModelOptions: KnowledgeSelectOption[]
  dimensions: string
  dimensionsErrorCode?: 'dimensionsInvalid'
  onEmbeddingModelChange: (embeddingModelId: string) => void
  onDimensionsChange: (dimensions: string) => void
}

const EmbeddingSection = ({
  embeddingModelId,
  embeddingModelOptions,
  dimensions,
  dimensionsErrorCode,
  onEmbeddingModelChange,
  onDimensionsChange
}: EmbeddingSectionProps) => {
  const { t } = useTranslation()

  return (
    <section className="space-y-2.5">
      <RagSectionTitle title={t('knowledge_v2.embedding_model')} icon={DatabaseZap} />

      <div className="grid grid-cols-[minmax(0,1fr)_8.75rem] gap-2">
        <div>
          <RagFieldLabel label={t('knowledge_v2.embedding_model')} hint={t('knowledge_v2.rag.hints.embedding_model')} />
          <RagSelectField
            value={embeddingModelId ?? undefined}
            options={embeddingModelOptions}
            placeholder={t('knowledge_v2.not_set')}
            onValueChange={onEmbeddingModelChange}
          />
        </div>

        <div>
          <RagNumericField
            label={t('knowledge_v2.dimensions')}
            value={dimensions}
            hint={t('knowledge_v2.rag.hints.dimensions')}
            onChange={onDimensionsChange}
          />
          {dimensionsErrorCode === 'dimensionsInvalid' ? (
            <div className="mt-1 text-[0.625rem] text-destructive leading-3.5">
              {t('knowledge.dimensions_error_invalid')}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}

export default EmbeddingSection
