import { useLocalModel } from '@renderer/hooks/useLocalModel'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { LOCAL_EMBEDDING_PROVIDER_ID, LOCAL_EMBEDDING_UNIQUE_MODEL_ID } from '@shared/data/presets/localEmbedding'
import type { Model } from '@shared/data/types/model'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { isEmbeddingModel, KnowledgeModelSelect, type KnowledgeModelSelectProps } from './KnowledgeModelSelect'

type KnowledgeEmbeddingModelSelectProps = Omit<KnowledgeModelSelectProps, 'filter' | 'prioritizedProviderIds'>

const LOCAL_EMBEDDING_PRIORITIZED_PROVIDER_IDS = [LOCAL_EMBEDDING_PROVIDER_ID] as const

export const KnowledgeEmbeddingModelSelect = (props: KnowledgeEmbeddingModelSelectProps) => {
  const { t } = useTranslation()
  const { onChange } = props
  const { status, isStatusResolved, download } = useLocalModel('embedding')

  const handleChange = useCallback(
    async (modelId: string | null) => {
      if (modelId === LOCAL_EMBEDDING_UNIQUE_MODEL_ID && (!isStatusResolved || status === 'unsupported')) {
        return
      }

      if (modelId !== LOCAL_EMBEDDING_UNIQUE_MODEL_ID || status === 'ready' || status === 'downloading') {
        onChange(modelId)
        return
      }

      const confirmed = await popup.confirm({
        title: t('knowledge.rag.download_local_embedding'),
        content: t('settings.dependencies.localModels.embedding.subtitle'),
        okText: t('settings.dependencies.localModels.download'),
        cancelText: t('common.cancel')
      })
      if (!confirmed) {
        return
      }

      onChange(modelId)
      void download().catch(() => toast.error(t('knowledge.rag.download_local_embedding_failed')))
    },
    [download, isStatusResolved, onChange, status, t]
  )

  const filter = useCallback(
    (model: Model) =>
      isEmbeddingModel(model) &&
      (model.id !== LOCAL_EMBEDDING_UNIQUE_MODEL_ID || (isStatusResolved && status !== 'unsupported')),
    [isStatusResolved, status]
  )

  return (
    <KnowledgeModelSelect
      {...props}
      filter={filter}
      prioritizedProviderIds={LOCAL_EMBEDDING_PRIORITIZED_PROVIDER_IDS}
      onChange={handleChange}
    />
  )
}
