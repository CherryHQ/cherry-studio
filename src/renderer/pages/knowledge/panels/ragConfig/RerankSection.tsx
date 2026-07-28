import { useTranslation } from 'react-i18next'

import { isRerankModel, KnowledgeModelSelect } from '../../components/KnowledgeModelSelect'
import { RagFieldLabel } from './panelPrimitives'

interface RerankSectionProps {
  rerankModelId: string | null
  onRerankModelChange: (rerankModelId: string | null) => void
}

const RerankSection = ({ rerankModelId, onRerankModelChange }: RerankSectionProps) => {
  const { t } = useTranslation()

  return (
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
  )
}

export default RerankSection
