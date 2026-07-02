import { useTranslation } from 'react-i18next'

import { isEmbeddingModel, KnowledgeModelSelect } from '../../components/KnowledgeModelSelect'
import LocalEmbeddingDownloadButton from './LocalEmbeddingDownloadButton'
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
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <KnowledgeModelSelect
              aria-label={t('knowledge.rag.embedding_model')}
              value={embeddingModelId}
              placeholder={t('knowledge.not_set')}
              filter={isEmbeddingModel}
              onChange={onEmbeddingModelChange}
            />
          </div>
          {embeddingModelId === null ? <LocalEmbeddingDownloadButton onSelected={onEmbeddingModelChange} /> : null}
        </div>
      </div>
    </div>
  )
}

export default EmbeddingSection
