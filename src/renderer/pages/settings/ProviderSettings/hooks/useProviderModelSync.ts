import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import { useModelMutations, useModels } from '@renderer/hooks/useModel'
import { useProvider } from '@renderer/hooks/useProvider'
import { MODELS_BATCH_MAX_ITEMS } from '@shared/data/api/schemas/models'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { useCallback } from 'react'

import { chunkArray } from '../utils/chunkArray'
import { fetchResolvedProviderModels, resolveCreateModelEndpointTypes, toCreateModelDto } from '../utils/modelSync'
import { PROVIDER_SETTINGS_MODEL_SWR_OPTIONS } from './providerSetting/constants'

const logger = loggerService.withContext('ProviderSettings:ModelSync')

interface UseProviderModelSyncOptions {
  existingModels?: Model[]
}

interface SyncProviderModelsOptions {
  providerId: string
  endpointProvider?: Parameters<typeof resolveCreateModelEndpointTypes>[0]
  existingModels?: readonly Model[]
  createModels: ReturnType<typeof useModelMutations>['createModels']
}

/**
 * Populate an empty provider from its remote model endpoint.
 *
 * Skips remote discovery when any local model already exists. Deep-link
 * auto-sync must therefore only call this for a newly created provider.
 */
export async function syncProviderModelsForProvider({
  providerId,
  endpointProvider,
  existingModels = [],
  createModels
}: SyncProviderModelsOptions): Promise<Model[]> {
  const latestModels: Model[] =
    existingModels.length > 0
      ? [...existingModels]
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

  logger.info('Fetching remote provider models for sync', { providerId })
  const resolvedModels = await fetchResolvedProviderModels(providerId)
  if (resolvedModels.length === 0) {
    logger.info('No remote provider models were resolved for sync', { providerId })
    return []
  }

  const existingModelIds = new Set<UniqueModelId>(latestModels.map((model) => model.id))
  const payload = resolvedModels
    .filter((model) => !existingModelIds.has(model.id))
    .map((model) => toCreateModelDto(providerId, model, resolveCreateModelEndpointTypes(endpointProvider, model)))

  const createdModels: Model[] = []
  for (const chunk of chunkArray(payload, MODELS_BATCH_MAX_ITEMS)) {
    const created = await createModels(chunk)
    createdModels.push(...created)
  }

  logger.info('Completed provider model sync', {
    providerId,
    createdModelCount: createdModels.length
  })
  return [...latestModels, ...createdModels]
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
  const { provider } = useProvider(providerId)
  const { createModels, isCreating } = useModelMutations()

  const syncProviderModels = useCallback(
    async (endpointProvider = provider) => {
      logger.info('Checking provider models before sync', {
        providerId,
        localModelCount: models.length
      })

      return syncProviderModelsForProvider({
        providerId,
        endpointProvider,
        existingModels: models,
        createModels
      })
    },
    [createModels, models, provider, providerId]
  )

  return {
    syncProviderModels,
    isSyncingModels: isCreating
  }
}
