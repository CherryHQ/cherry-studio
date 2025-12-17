import { loggerService } from '@logger'
import db from '@renderer/databases'
import { getModelUniqId } from '@renderer/services/ModelService'
import { sortBy } from 'lodash'
import { useCallback, useEffect, useState } from 'react'

import { useProviders } from './useProvider'

const logger = loggerService.withContext('usePinnedModels')

export const usePinnedModels = () => {
  const [pinnedModels, setPinnedModels] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const { providers } = useProviders()

  useEffect(() => {
    const loadPinnedModels = async () => {
      setLoading(true)
      const setting = await db.settings.get('pinned:models')
      const savedPinnedModels = setting?.value || []

      // Filter out invalid pinned models
      const allModelIds = providers.flatMap((p) => p.models || []).map((m) => getModelUniqId(m))
      const validPinnedModels = savedPinnedModels.filter((id) => allModelIds.includes(id))

      // Update storage if there were invalid models
      if (validPinnedModels.length !== savedPinnedModels.length) {
        await db.settings.put({ id: 'pinned:models', value: validPinnedModels })
      }

      setPinnedModels(sortBy(validPinnedModels))
      setLoading(false)
    }

    loadPinnedModels().catch((error) => {
      logger.error('Failed to load pinned models', error)
      setPinnedModels([])
      setLoading(false)
    })
  }, [providers])

  const updatePinnedModels = useCallback(async (models: string[]) => {
    await db.settings.put({ id: 'pinned:models', value: models })
    setPinnedModels(sortBy(models))
  }, [])

  /**
   * Toggle a single pinned model
   * @param modelId - The ID string of the model to toggle
   */
  const togglePinnedModel = useCallback(
    async (modelId: string) => {
      try {
        const newPinnedModels = pinnedModels.includes(modelId)
          ? pinnedModels.filter((id) => id !== modelId)
          : [...pinnedModels, modelId]
        await updatePinnedModels(newPinnedModels)
      } catch (error) {
        logger.error('Failed to toggle pinned model', error as Error)
      }
    },
    [pinnedModels, updatePinnedModels]
  )

  return { pinnedModels, updatePinnedModels, togglePinnedModel, loading }
}
