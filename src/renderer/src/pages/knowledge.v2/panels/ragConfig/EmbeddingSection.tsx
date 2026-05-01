import type { KnowledgeSelectOption } from '@renderer/pages/knowledge.v2/types'
import { DatabaseZap } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { RagReadonlyField, RagSectionTitle } from './panelPrimitives'

interface EmbeddingSectionProps {
  embeddingModelId: string | null
  embeddingModelOptions: KnowledgeSelectOption[]
  dimensions: number
}

const EmbeddingSection = ({ embeddingModelId, embeddingModelOptions, dimensions }: EmbeddingSectionProps) => {
  const { t } = useTranslation()
  const embeddingModelLabel = useMemo(() => {
    if (!embeddingModelId) {
      return t('knowledge_v2.not_set')
    }

    return embeddingModelOptions.find((option) => option.value === embeddingModelId)?.label ?? embeddingModelId
  }, [embeddingModelId, embeddingModelOptions, t])

  return (
    <section className="space-y-2.5">
      <RagSectionTitle title={t('knowledge_v2.embedding_model')} icon={DatabaseZap} />

      <div className="grid grid-cols-[minmax(0,1fr)_8.75rem] gap-2">
        <RagReadonlyField
          label={t('knowledge_v2.embedding_model')}
          value={embeddingModelLabel}
          hint={t('knowledge_v2.rag.hints.embedding_model')}
        />

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
