import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import LocalModelDownloadPopup from '@renderer/components/popups/LocalModelDownloadPopup'
import { useLocalModel } from '@renderer/hooks/useLocalModel'
import {
  LOCAL_EMBEDDING_MODELS,
  LOCAL_EMBEDDING_PROVIDER_ID,
  localEmbeddingBundleIdForUniqueModelId,
  localEmbeddingPresetForBundleId
} from '@shared/data/presets/localEmbedding'
import type { Model } from '@shared/data/types/model'

import { isEmbeddingModel, KnowledgeModelSelect, type KnowledgeModelSelectProps } from './KnowledgeModelSelect'

type KnowledgeEmbeddingModelSelectProps = Omit<KnowledgeModelSelectProps, 'filter' | 'prioritizedProviderIds'>

const LOCAL_EMBEDDING_PRIORITIZED_PROVIDER_IDS = [LOCAL_EMBEDDING_PROVIDER_ID] as const

export const KnowledgeEmbeddingModelSelect = (props: KnowledgeEmbeddingModelSelectProps) => {
  const { t } = useTranslation()
  const { onChange } = props
  // Fixed hook order: one status subscription per builtin local embedding model.
  const qwenEmbedding = useLocalModel(LOCAL_EMBEDDING_MODELS[0].bundleId)
  const harrierEmbedding = useLocalModel(LOCAL_EMBEDDING_MODELS[1].bundleId)
  const localEmbeddingStatusByBundleId = {
    [LOCAL_EMBEDDING_MODELS[0].bundleId]: qwenEmbedding,
    [LOCAL_EMBEDDING_MODELS[1].bundleId]: harrierEmbedding
  }

  const handleChange = useCallback(
    async (modelId: string | null) => {
      const bundleId = modelId ? localEmbeddingBundleIdForUniqueModelId(modelId) : undefined
      if (!bundleId) {
        onChange(modelId)
        return
      }

      const { status, isStatusResolved } = localEmbeddingStatusByBundleId[bundleId]
      if (!isStatusResolved || status === 'unsupported') {
        return
      }

      if (status === 'ready' || status === 'downloading') {
        onChange(modelId)
        return
      }

      // Resolves only once the model is on disk — see LocalModelDownloadPopup.
      const downloaded = await LocalModelDownloadPopup.show({
        id: bundleId,
        description: t(localEmbeddingPresetForBundleId(bundleId)?.downloadDescriptionKey ?? '')
      })
      if (!downloaded) {
        return
      }

      onChange(modelId)
    },
    // `localEmbeddingStatusByBundleId` is rebuilt every render from fixed hooks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      onChange,
      qwenEmbedding.status,
      qwenEmbedding.isStatusResolved,
      harrierEmbedding.status,
      harrierEmbedding.isStatusResolved,
      t
    ]
  )

  const filter = useCallback(
    (model: Model) => {
      if (!isEmbeddingModel(model)) return false
      const bundleId = localEmbeddingBundleIdForUniqueModelId(model.id)
      if (!bundleId) return true
      // Hide a builtin local model this platform cannot run at all; the settings
      // download cards do the same (see LocalModelsSection).
      const { status, isStatusResolved } = localEmbeddingStatusByBundleId[bundleId]
      return isStatusResolved && status !== 'unsupported'
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qwenEmbedding.status, qwenEmbedding.isStatusResolved, harrierEmbedding.status, harrierEmbedding.isStatusResolved]
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
