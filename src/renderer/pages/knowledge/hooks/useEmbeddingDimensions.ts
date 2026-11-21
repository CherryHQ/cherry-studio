import { useCallback, useState } from 'react'

import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { LOCAL_EMBEDDING_PROVIDER_ID, getLocalEmbeddingDimensions } from '@shared/data/presets/localEmbedding'
import { UniqueModelIdSchema } from '@shared/data/types/model'

import { normalizeKnowledgeError } from '../utils/error'

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

    // Builtin local embedding models run in-process with fixed output dimensions —
    // return them directly instead of loading the weights just to count dims.
    const localDimensions = parsedModelId.startsWith(`${LOCAL_EMBEDDING_PROVIDER_ID}::`)
      ? getLocalEmbeddingDimensions(parsedModelId)
      : undefined
    if (localDimensions !== undefined) {
      return localDimensions
    }

    const { embeddings } = await ipcApi.request('ai.embedding.embed_many', {
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
