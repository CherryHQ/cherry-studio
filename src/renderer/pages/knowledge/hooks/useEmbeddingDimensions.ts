import { loggerService } from '@logger'
import { UniqueModelIdSchema } from '@shared/data/types/model'
import { useCallback, useState } from 'react'

import { normalizeKnowledgeError } from '../utils'

const logger = loggerService.withContext('useEmbeddingDimensions')

const EMBEDDING_DIMENSION_PROBE_TEXT = 'test'
const INVALID_EMBEDDING_DIMENSIONS_ERROR = 'Invalid embedding dimensions'

const getEmbeddingDimensions = (embeddings: number[][]): number => {
  const dimensions = embeddings[0]?.length ?? 0

  if (dimensions <= 0) {
    throw new Error(INVALID_EMBEDDING_DIMENSIONS_ERROR)
  }

  return dimensions
}

const fetchEmbeddingDimensions = async (uniqueModelId: string): Promise<number> => {
  try {
    const parsedModelId = UniqueModelIdSchema.parse(uniqueModelId)
    const { embeddings } = await window.api.ai.embedMany({
      uniqueModelId: parsedModelId,
      values: [EMBEDDING_DIMENSION_PROBE_TEXT]
    })

    return getEmbeddingDimensions(embeddings)
  } catch (error) {
    const normalizedError = normalizeKnowledgeError(error)
    logger.error('Failed to get embedding dimensions', normalizedError, { uniqueModelId })
    throw normalizedError
  }
}

export const useEmbeddingDimensions = () => {
  const [isFetchingDimensions, setIsFetchingDimensions] = useState(false)

  const fetchDimensions = useCallback(async (uniqueModelId: string): Promise<number> => {
    setIsFetchingDimensions(true)

    return fetchEmbeddingDimensions(uniqueModelId).then(
      (dimensions) => {
        setIsFetchingDimensions(false)
        return dimensions
      },
      (error) => {
        setIsFetchingDimensions(false)
        throw error
      }
    )
  }, [])

  return {
    fetchDimensions,
    isFetchingDimensions
  }
}
