import { useTranslation } from 'react-i18next'

import { KnowledgeEmbeddingModelSelect } from '../../components/KnowledgeEmbeddingModelSelect'
import { RagFieldLabel } from './panelPrimitives'

interface EmbeddingSectionProps {
  embeddingModelId: string | null
  onEmbeddingModelChange: (embeddingModelId: string | null) => void
}

const EmbeddingSection = ({ embeddingModelId, onEmbeddingModelChange }: EmbeddingSectionProps) => {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-4">
      <div>
        <RagFieldLabel label={t('knowledge.rag.embedding_model')} hint={t('knowledge.rag.hints.embedding_model')} />
        <KnowledgeEmbeddingModelSelect
          aria-label={t('knowledge.rag.embedding_model')}
          value={embeddingModelId}
          placeholder={t('knowledge.rag.rerank_disabled')}
          noneOptionLabel={t('knowledge.rag.rerank_disabled')}
          onChange={onEmbeddingModelChange}
        />
      </div>
    </div>
  )
}

export default EmbeddingSection
