import { loggerService } from '@logger'
import AiProviderNew from '@renderer/aiCore/index_new'
import { useKnowledgeBases } from '@renderer/data/hooks/useKnowledges'
import { useProviders } from '@renderer/hooks/useProvider'
import type { KnowledgeBase } from '@renderer/types'
import { getErrorMessage } from '@renderer/utils'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { buildKnowledgeBasePayload } from '../utils/knowledgeBasePayload'

const logger = loggerService.withContext('useCreateKnowledgeBase')

interface UseCreateKnowledgeBaseOptions {
  onSuccess?: (baseId: string) => void
  onError?: (error: Error) => void
}

/**
 * Hook for creating a new knowledge base
 *
 * Handles validation, auto-fetching dimensions, and API call.
 */
export function useCreateKnowledgeBase(options: UseCreateKnowledgeBaseOptions = {}) {
  const { onSuccess, onError } = options
  const [loading, setLoading] = useState(false)
  const { t } = useTranslation()
  const { providers } = useProviders()
  const { createKnowledgeBase } = useKnowledgeBases()

  const submit = useCallback(
    async (newBase: KnowledgeBase) => {
      if (!newBase.name?.trim()) {
        window.toast.error(t('knowledge.name_required'))
        return
      }

      if (!newBase.model) {
        window.toast.error(t('knowledge.embedding_model_required'))
        return
      }

      setLoading(true)

      try {
        let dimensions = newBase.dimensions

        // Auto-fetch dimensions if not manually set
        if (!dimensions) {
          const provider = providers.find((p) => p.id === newBase.model.provider)

          if (!provider) {
            window.toast.error(t('knowledge.provider_not_found'))
            setLoading(false)
            return
          }

          try {
            const aiProvider = new AiProviderNew(provider)
            dimensions = await aiProvider.getEmbeddingDimensions(newBase.model)
            logger.info('Auto-fetched embedding dimensions', { dimensions, modelId: newBase.model.id })
          } catch (error) {
            logger.error('Failed to get embedding dimensions', error as Error)
            window.toast.error(t('message.error.get_embedding_dimensions') + '\n' + getErrorMessage(error))
            setLoading(false)
            return
          }
        }

        logger.info('Creating knowledge base via Data API', {
          id: newBase.id,
          name: newBase.name,
          modelId: newBase.model?.id,
          provider: newBase.model?.provider,
          dimensions
        })

        const payload = buildKnowledgeBasePayload({ ...newBase, dimensions })
        const newBaseV2 = await createKnowledgeBase(payload)

        onSuccess?.(newBaseV2.id)
      } catch (error) {
        logger.error('KnowledgeBase creation failed:', error as Error)
        window.toast.error(t('knowledge.error.failed_to_create') + getErrorMessage(error))
        onError?.(error as Error)
      } finally {
        setLoading(false)
      }
    },
    [t, providers, createKnowledgeBase, onSuccess, onError]
  )

  return { submit, loading }
}
