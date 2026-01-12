/**
 * Knowledge Base Form Hook v2 - Data API based
 *
 * Manages the state and handlers for a knowledge base form using v2 types.
 * During migration, this coexists with useKnowledgeBaseForm.ts (v1 Redux-based).
 *
 * @see {@link docs/en/references/data/README.md} for Data System reference
 * @see {@link v2-refactor-temp/docs/knowledge/knowledge-data-api.md} for Knowledge Data API design
 */

import { getEmbeddingMaxContext } from '@renderer/config/embedings'
import { useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId } from '@renderer/services/ModelService'
import type { KnowledgeBase } from '@renderer/types'
import { nanoid } from 'nanoid'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const createInitialKnowledgeBase = (): KnowledgeBase => ({
  id: nanoid(),
  name: '',
  model: null as any, // model is required, but will be set by user interaction
  items: [],
  created_at: Date.now(),
  updated_at: Date.now(),
  version: 1
})

/**
 * A hook that manages the state and handlers for a knowledge base form.
 *
 * The hook provides:
 * - A state object `newBase` that tracks the current form values.
 * - A function `setNewBase` to update the form state.
 * - A set of handlers for various form actions:
 *   - `handleEmbeddingModelChange`: Updates the embedding model.
 *   - `handleRerankModelChange`: Updates the rerank model.
 *   - `handleDimensionChange`: Updates the dimensions.
 *   - `handleDocPreprocessChange`: Updates the document preprocess provider.
 *   - `handleChunkSizeChange`: Updates the chunk size.
 *   - `handleChunkOverlapChange`: Updates the chunk overlap.
 *   - `handleThresholdChange`: Updates the threshold.
 * @param base - The base knowledge base to use as the initial state. If not provided, an empty base will be used.
 * @returns An object containing the new base state, a function to update the base, and handlers for various form actions.
 *          Also includes provider data for dropdown options and selected provider.
 */
export const useKnowledgeBaseForm = (base?: KnowledgeBase) => {
  const { t } = useTranslation()
  const [newBase, setNewBase] = useState<KnowledgeBase>(base || createInitialKnowledgeBase())
  const { providers } = useProviders()

  // TODO: Migrate usePreprocessProviders to v2 Data API
  // Currently using mock data - needs to be implemented when preprocess providers are migrated
  const preprocessProviders = useMemo(() => {
    // TODO: Replace with v2 preprocess providers from Data API
    return [] as Array<{ id: string; name: string; apiKey?: string }>
  }, [])

  useEffect(() => {
    if (base) {
      setNewBase(base)
    }
  }, [base])

  // TODO: Migrate to v2 - preprocessProvider structure will change to just preprocessProviderId
  const selectedDocPreprocessProvider = useMemo(
    () => newBase.preprocessProvider?.provider,
    [newBase.preprocessProvider]
  )

  const docPreprocessSelectOptions = useMemo(() => {
    // TODO: Implement when preprocess providers are migrated to v2 Data API
    const preprocessOptions = {
      label: t('settings.tool.preprocess.provider'),
      title: t('settings.tool.preprocess.provider'),
      options: preprocessProviders
        .filter((p) => p.apiKey !== '' || ['mineru', 'open-mineru'].includes(p.id))
        .map((p) => ({ value: p.id, label: p.name }))
    }
    return [preprocessOptions]
  }, [preprocessProviders, t])

  // TODO: In v2, this should update embeddingModelId and embeddingModelMeta instead of model object
  const handleEmbeddingModelChange = useCallback(
    (value: string) => {
      const model = providers.flatMap((p) => p.models).find((m) => getModelUniqId(m) === value)
      if (model) {
        setNewBase((prev) => ({ ...prev, model }))
      }
    },
    [providers]
  )

  // TODO: In v2, this should update rerankModelId and rerankModelMeta instead of rerankModel object
  const handleRerankModelChange = useCallback(
    (value: string) => {
      const rerankModel = value
        ? providers.flatMap((p) => p.models).find((m) => getModelUniqId(m) === value)
        : undefined
      setNewBase((prev) => ({ ...prev, rerankModel }))
    },
    [providers]
  )

  // TODO: In v2, dimensions should be stored in embeddingModelMeta.dimensions
  const handleDimensionChange = useCallback((value: number | null) => {
    setNewBase((prev) => ({ ...prev, dimensions: value || undefined }))
  }, [])

  // TODO: In v2, this should update preprocessProviderId instead of preprocessProvider object
  const handleDocPreprocessChange = useCallback(
    (value: string) => {
      // TODO: Replace with v2 preprocess provider lookup from Data API
      const provider = preprocessProviders.find((p) => p.id === value)
      if (!provider) {
        setNewBase((prev) => ({ ...prev, preprocessProvider: undefined }))
        return
      }
      // TODO: This structure will be simplified to just preprocessProviderId in v2
      setNewBase((prev) => ({
        ...prev,
        preprocessProvider: {
          type: 'preprocess',
          provider: provider as any
        }
      }))
    },
    [preprocessProviders]
  )

  const handleChunkSizeChange = useCallback(
    (value: number | null) => {
      const modelId = newBase.model?.id || base?.model?.id
      if (!modelId) return
      const maxContext = getEmbeddingMaxContext(modelId)
      if (!value || !maxContext || value <= maxContext) {
        setNewBase((prev) => ({ ...prev, chunkSize: value || undefined }))
      }
    },
    [newBase.model, base?.model]
  )

  const handleChunkOverlapChange = useCallback(
    (value: number | null) => {
      if (!value || (newBase.chunkSize && newBase.chunkSize > value)) {
        setNewBase((prev) => ({ ...prev, chunkOverlap: value || undefined }))
      } else {
        window.toast.error(t('message.error.chunk_overlap_too_large'))
      }
    },
    [newBase.chunkSize, t]
  )

  const handleThresholdChange = useCallback(
    (value: number | null) => {
      setNewBase((prev) => ({ ...prev, threshold: value || undefined }))
    },
    [setNewBase]
  )

  const handlers = {
    handleEmbeddingModelChange,
    handleRerankModelChange,
    handleDimensionChange,
    handleDocPreprocessChange,
    handleChunkSizeChange,
    handleChunkOverlapChange,
    handleThresholdChange
  }

  const providerData = {
    providers,
    preprocessProviders,
    selectedDocPreprocessProvider,
    docPreprocessSelectOptions
  }

  return { newBase, setNewBase, handlers, providerData }
}
