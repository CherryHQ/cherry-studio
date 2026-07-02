import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { LOCAL_EMBEDDING_DIMENSIONS, LOCAL_EMBEDDING_UNIQUE_MODEL_ID } from '@shared/data/presets/localEmbedding'
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

    // The local embedding model runs in-process with a fixed output dimension —
    // return it directly instead of loading the 600MB model just to count dims.
    if (parsedModelId === LOCAL_EMBEDDING_UNIQUE_MODEL_ID) {
      return LOCAL_EMBEDDING_DIMENSIONS
    }

    const { embeddings } = await ipcApi.request('ai.embed_many', {
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
