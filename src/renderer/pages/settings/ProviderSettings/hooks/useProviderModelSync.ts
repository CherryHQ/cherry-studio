import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import { useModelMutations, useModels } from '@renderer/hooks/useModel'
import { MODELS_BATCH_MAX_ITEMS } from '@shared/data/api/schemas/models'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { useCallback } from 'react'

import { fetchResolvedProviderModels, toCreateModelDto } from '../ModelList/modelSync'
import { chunkArray } from '../utils/chunkArray'
import { PROVIDER_SETTINGS_MODEL_SWR_OPTIONS } from './providerSetting/constants'

const logger = loggerService.withContext('ProviderSettings:ModelSync')

interface UseProviderModelSyncOptions {
  existingModels?: Model[]
}

export function useProviderModelSync(providerId: string, options: UseProviderModelSyncOptions = {}) {
  const fallbackModelsQuery = useModels(
    { providerId },
    {
      fetchEnabled: options.existingModels ? false : undefined,
      swrOptions: PROVIDER_SETTINGS_MODEL_SWR_OPTIONS
    }
  )
  const models = options.existingModels ?? fallbackModelsQuery.models
  const { createModels, isCreating } = useModelMutations()

  const syncProviderModels = useCallback(async (): Promise<Model[]> => {
    logger.info('Checking provider models before sync', {
      providerId,
      localModelCount: models.length
    })

    // `useModels` returns a readonly SWR slice — copy into a mutable array so
    // the function's `Promise<Model[]>` return type is satisfied without
    // pushing `readonly` all the way through the public API.
    const latestModels: Model[] =
      models.length > 0
        ? [...models]
        : await dataApiService.get('/models', {
            query: { providerId }
          })

    if (latestModels.length > 0) {
      logger.info('Skipping provider model creation because models already exist', {
        providerId,
        modelCount: latestModels.length
      })
      return latestModels
    }

    logger.info('Fetching remote provider models for sync', {
      providerId
    })
    const resolvedModels = await fetchResolvedProviderModels(providerId)
    if (resolvedModels.length === 0) {
      logger.info('No remote provider models were resolved for sync', {
        providerId
      })
      return []
    }

    logger.info('Resolved remote provider models for sync', {
      providerId,
      resolvedModelCount: resolvedModels.length
    })

    const existingModelIds = new Set<UniqueModelId>(latestModels.map((model) => model.id))
    const payload = resolvedModels
      .filter((model) => !existingModelIds.has(model.id))
      .map((model) => toCreateModelDto(providerId, model))

    if (payload.length === 0) {
      logger.info('Skipping provider model creation because resolved models are already present', {
        providerId,
        resolvedModelCount: resolvedModels.length
      })
      return latestModels
    }

    const chunks = chunkArray(payload, MODELS_BATCH_MAX_ITEMS)
    const createdModels: Model[] = []

    logger.info('Creating provider models from resolved remote list', {
      providerId,
      createCount: payload.length,
      chunkCount: chunks.length
    })

    for (const chunk of chunks) {
      const created = await createModels(chunk)
      createdModels.push(...created)
    }

    logger.info('Completed provider model sync', {
      providerId,
      createdModelCount: createdModels.length
    })

    return [...latestModels, ...createdModels]
  }, [createModels, models, providerId])

  return {
    syncProviderModels,
    isSyncingModels: isCreating
  }
}
