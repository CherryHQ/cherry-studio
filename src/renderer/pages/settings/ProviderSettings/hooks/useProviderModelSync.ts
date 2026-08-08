import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import { useModelMutations, useModels } from '@renderer/hooks/useModel'
import { useProvider } from '@renderer/hooks/useProvider'
import { MODELS_BATCH_MAX_ITEMS } from '@shared/data/api/schemas/models'
import { type Model, MODEL_CAPABILITY, type UniqueModelId } from '@shared/data/types/model'
import { isOllamaProvider } from '@shared/utils/provider'
import { isEqual } from 'es-toolkit/compat'
import { useCallback } from 'react'

import { chunkArray } from '../utils/chunkArray'
import { fetchResolvedProviderModels, resolveCreateModelEndpointTypes, toCreateModelDto } from '../utils/modelSync'
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
  const { provider } = useProvider(providerId)
  const { createModels, updateModels, isCreating, isBulkUpdating } = useModelMutations()

  const syncProviderModels = useCallback(
    async (endpointProvider = provider) => {
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

      const shouldRefreshReasoning = endpointProvider ? isOllamaProvider(endpointProvider) : false
      if (latestModels.length > 0 && !shouldRefreshReasoning) {
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
        return latestModels
      }

      logger.info('Resolved remote provider models for sync', {
        providerId,
        resolvedModelCount: resolvedModels.length
      })

      if (latestModels.length > 0) {
        const localById = new Map(latestModels.map((model) => [model.id, model]))
        const reasoningUpdates = resolvedModels.flatMap((model) => {
          const local = localById.get(model.id)
          const reasoning = model.providerDeclaredReasoning
          if (!local || !reasoning) {
            return []
          }

          const patch = {
            ...(!isEqual(local.reasoning, reasoning) ? { reasoning } : {}),
            ...(!local.presetModelId && !local.capabilities.includes(MODEL_CAPABILITY.REASONING)
              ? { capabilities: [...local.capabilities, MODEL_CAPABILITY.REASONING] }
              : {})
          }
          return Object.keys(patch).length > 0 ? [{ uniqueModelId: local.id, patch }] : []
        })
        if (reasoningUpdates.length === 0) {
          return latestModels
        }

        const updatedModels = await updateModels(reasoningUpdates)
        const updatedById = new Map(updatedModels.map((model) => [model.id, model]))
        logger.info('Updated provider-declared reasoning for existing models', {
          providerId,
          updatedModelCount: updatedModels.length
        })
        return latestModels.map((model) => updatedById.get(model.id) ?? model)
      }

      const existingModelIds = new Set<UniqueModelId>(latestModels.map((model) => model.id))
      const payload = resolvedModels
        .filter((model) => !existingModelIds.has(model.id))
        .map((model) => toCreateModelDto(providerId, model, resolveCreateModelEndpointTypes(endpointProvider, model)))

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
    },
    [createModels, models, provider, providerId, updateModels]
  )

  return {
    syncProviderModels,
    isSyncingModels: isCreating || isBulkUpdating
  }
}
