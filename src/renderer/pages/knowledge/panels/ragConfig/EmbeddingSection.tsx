import { useTranslation } from 'react-i18next'

import type { KnowledgeSelectOption } from '../../types'
import { RagFieldLabel, RagSelectField } from './panelPrimitives'

interface EmbeddingSectionProps {
  embeddingModelId: string | null
  embeddingModelOptions: KnowledgeSelectOption[]
  onEmbeddingModelChange: (embeddingModelId: string) => void
}

const EmbeddingSection = ({
  embeddingModelId,
  embeddingModelOptions,
  onEmbeddingModelChange
}: EmbeddingSectionProps) => {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-4">
      <div>
        <RagFieldLabel label={t('knowledge.rag.embedding_model')} hint={t('knowledge.rag.hints.embedding_model')} />
        <RagSelectField
          value={embeddingModelId ?? undefined}
          options={embeddingModelOptions}
          placeholder={t('knowledge.not_set')}
          onValueChange={onEmbeddingModelChange}
        />
      </div>
    </div>
  )
}

export default EmbeddingSection
