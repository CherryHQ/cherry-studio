import { getEmbeddingMaxContext } from '@renderer/config/embedings'
import { usePreprocessProviders } from '@renderer/hooks/usePreprocess'
import { useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId } from '@renderer/services/ModelService'
import { KnowledgeBase } from '@renderer/types'
import { nanoid } from 'nanoid'
import { useCallback, useMemo, useState } from 'react'
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
  const { preprocessProviders } = usePreprocessProviders()

  const selectedDocPreprocessProvider = useMemo(
    () => newBase.preprocessProvider?.provider,
    [newBase.preprocessProvider]
  )

  const docPreprocessSelectOptions = useMemo(() => {
    const preprocessOptions = {
      label: t('settings.tool.preprocess.provider'),
      title: t('settings.tool.preprocess.provider'),
      options: preprocessProviders
        .filter((p) => p.apiKey !== '' || p.id === 'mineru')
        .map((p) => ({ value: p.id, label: p.name }))
    }
    return [preprocessOptions]
  }, [preprocessProviders, t])

  const handleEmbeddingModelChange = useCallback(
    (value: string) => {
      const model = providers.flatMap((p) => p.models).find((m) => getModelUniqId(m) === value)
      if (model) {
        setNewBase((prev) => ({ ...prev, model }))
      }
    },
    [providers]
  )

  const handleRerankModelChange = useCallback(
    (value: string) => {
      const rerankModel = value
        ? providers.flatMap((p) => p.models).find((m) => getModelUniqId(m) === value)
        : undefined
      setNewBase((prev) => ({ ...prev, rerankModel }))
    },
    [providers]
  )

  const handleDimensionChange = useCallback((value: number | null) => {
    setNewBase((prev) => ({ ...prev, dimensions: value || undefined }))
  }, [])

  const handleDocPreprocessChange = useCallback(
    (value: string) => {
      const provider = preprocessProviders.find((p) => p.id === value)
      if (!provider) {
        setNewBase((prev) => ({ ...prev, preprocessProvider: undefined }))
        return
      }
      setNewBase((prev) => ({
        ...prev,
        preprocessProvider: {
          type: 'preprocess',
          provider
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
        window.message.error(t('message.error.chunk_overlap_too_large'))
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
