import type { KnowledgeSelectOption } from '@renderer/pages/knowledge/types'
import type { KnowledgeSearchMode } from '@shared/data/types/knowledge'
import { useTranslation } from 'react-i18next'

import { RagFieldLabel, RagSelectField } from './panelPrimitives'

const EMPTY_OPTION_VALUE = '__none__'

interface RetrievalSectionProps {
  searchModeOptions: KnowledgeSelectOption[]
  rerankModelOptions: KnowledgeSelectOption[]
  searchMode: KnowledgeSearchMode
  rerankModelId: string | null
  onSearchModeChange: (value: KnowledgeSearchMode) => void
  onRerankModelChange: (value: string | null) => void
}

const RetrievalSection = ({
  searchModeOptions,
  rerankModelOptions,
  searchMode,
  rerankModelId,
  onSearchModeChange,
  onRerankModelChange
}: RetrievalSectionProps) => {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-4">
      <div>
        <RagFieldLabel label={t('knowledge.rag.search_mode.title')} hint={t('knowledge.rag.hints.search_mode')} />
        <RagSelectField
          value={searchMode}
          options={searchModeOptions}
          onValueChange={(value) => onSearchModeChange(value as KnowledgeSearchMode)}
        />
      </div>

      <div>
        <RagFieldLabel label={t('knowledge.rag.rerank_model')} hint={t('knowledge.rag.hints.rerank_model')} />
        <RagSelectField
          value={rerankModelId ?? EMPTY_OPTION_VALUE}
          options={[{ value: EMPTY_OPTION_VALUE, label: t('knowledge.rag.rerank_disabled') }, ...rerankModelOptions]}
          onValueChange={(value) => onRerankModelChange(value === EMPTY_OPTION_VALUE ? null : value)}
        />
      </div>
    </div>
  )
}

export default RetrievalSection
