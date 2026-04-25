import type { KnowledgeSelectOption } from '@renderer/pages/knowledge.v2/types'
import { DatabaseZap } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { RagFieldLabel, RagReadonlyField, RagSectionTitle, RagSelectField } from './panelPrimitives'

interface EmbeddingSectionProps {
  embeddingModelId: string | null
  embeddingModelOptions: KnowledgeSelectOption[]
  dimensions: number
  onEmbeddingModelChange: (value: string) => void
}

const EmbeddingSection = ({
  embeddingModelId,
  embeddingModelOptions,
  dimensions,
  onEmbeddingModelChange
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

        <RagReadonlyField
          label={t('knowledge_v2.dimensions')}
          value={String(dimensions)}
          hint={t('knowledge_v2.rag.hints.dimensions')}
        />
      </div>
    </section>
  )
}

export default EmbeddingSection
