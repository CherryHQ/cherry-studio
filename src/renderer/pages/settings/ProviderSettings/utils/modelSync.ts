import { isEmpty } from 'es-toolkit/compat'

import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import i18n from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'
import type { CreateModelDto } from '@shared/data/api/schemas/models'
import type { ConcreteApiPaths } from '@shared/data/api/types'
import {
  type EndpointType as RuntimeEndpointType,
  type ListedModels,
  type Model,
  parseUniqueModelId
} from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isNewApiProvider } from '@shared/utils/provider'

const logger = loggerService.withContext('ProviderModelSync')

export type ModelSyncErrorCode = 'NO_ENABLED_API_KEY'

export class ModelSyncError extends Error {
  constructor(
    message: string,
    public readonly code: ModelSyncErrorCode,
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Diagnostic metadata is caller-owned and carried unchanged with the error, without interpreting its fields.
    public readonly meta?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'ModelSyncError'
  }
}

type ProviderResolveModelsPath = Extract<ConcreteApiPaths, `/providers/${string}/models:resolve`>
type ModelSyncProviderEndpointSource = Pick<Provider, 'id' | 'presetProviderId' | 'defaultChatEndpoint'>

export function resolveCreateModelEndpointTypes(
  provider: ModelSyncProviderEndpointSource | null | undefined,
  model: Pick<Model, 'endpointTypes'>
): RuntimeEndpointType[] | undefined {
  if (model.endpointTypes?.length) {
    return [...model.endpointTypes]
  }

  if (!provider || !isNewApiProvider(provider)) {
    return undefined
  }

  return provider.defaultChatEndpoint ? [provider.defaultChatEndpoint] : undefined
}

function getRawModelId(model: Pick<Partial<Model>, 'apiModelId' | 'id'>): string {
  return model.apiModelId ?? (model.id ? parseUniqueModelId(model.id).modelId : '')
}

export function toCreateModelDto(
  providerId: string,
  model: Model,
  endpointTypes?: RuntimeEndpointType[]
): CreateModelDto {
  const modelId = getRawModelId(model)
  const resolvedEndpointTypes = endpointTypes?.length ? endpointTypes : model.endpointTypes
  const capabilities = !model.presetModelId && model.capabilities?.length ? model.capabilities : undefined

  const input: CreateModelDto = {
    providerId,
    modelId,
    name: model.name,
    group: model.group
  }
  if (capabilities) input.capabilities = [...capabilities]
  if (resolvedEndpointTypes?.length) input.endpointTypes = [...resolvedEndpointTypes]
  // Discovered rather than registry-supplied for local providers — Ollama's window comes from
  // `/api/show`, and dropping it here leaves the row without one, so no `num_ctx` is ever sent.
  if (model.contextWindow) input.contextWindow = model.contextWindow
  return input
}

/**
 * Enrich raw v2 models from `ipcApi.request('ai.provider.model.list', …)` with registry
 * metadata fetched via `/providers/:id/models:resolve`. The IPC already
 * returns v2 `Partial<Model>` (with `apiModelId`, `endpointTypes`, etc.)
 * — this layer overlays preset capabilities/limits/pricing that aren't
 * available from the upstream provider SDK.
 */
async function enrichFetchedModels(providerId: string, fetchedModels: Partial<Model>[]): Promise<Model[]> {
  const filteredModels = fetchedModels.filter((model) => !isEmpty(model.name))
  if (filteredModels.length === 0) {
    return []
  }

  const modelIds = filteredModels.map(getRawModelId)
  if (modelIds.some((modelId) => !modelId)) {
    throw new Error(i18n.t('settings.models.manage.sync_pull_failed'))
  }

  const resolveModelsPath = `/providers/${providerId}/models:resolve` as const satisfies ProviderResolveModelsPath
  const resolved = await dataApiService.get(resolveModelsPath, { query: { ids: modelIds } })

  const resolvedMap = new Map<string, Model>()
  for (const model of resolved) {
    const key = model.apiModelId ?? parseUniqueModelId(model.id).modelId
    if (!resolvedMap.has(key)) {
      resolvedMap.set(key, model)
    }
  }

  const REGISTRY_FIELDS = [
    'name',
    'presetModelId',
    'description',
    'group',
    'capabilities',
    'inputModalities',
    'outputModalities',
    'endpointTypes',
    'contextWindow',
    'maxOutputTokens',
    'maxInputTokens',
    'reasoning',
    'pricing',
    'family',
    'ownedBy'
  ] as const

  return filteredModels.map((fetched, index) => {
    // Match the exact raw model ID so normalized catalog names cannot collapse distinct SKUs.
    const registry = resolvedMap.get(modelIds[index])

    if (!registry) {
      throw new Error(i18n.t('settings.models.manage.sync_pull_failed'))
    }

    const merged = {
      ...fetched,
      id: fetched.id ?? registry.id,
      providerId: fetched.providerId ?? registry.providerId,
      name: fetched.name ?? registry.name,
      capabilities: fetched.capabilities ?? registry.capabilities,
      supportsStreaming: fetched.supportsStreaming ?? registry.supportsStreaming,
      isEnabled: fetched.isEnabled ?? registry.isEnabled,
      isHidden: fetched.isHidden ?? registry.isHidden
    } satisfies Model
    // Fetchers use the raw id when the API has no display name; only then use the registry name.
    const keepFetchedName = !!fetched.name && fetched.name !== fetched.apiModelId

    for (const field of REGISTRY_FIELDS) {
      if (field === 'endpointTypes' && fetched.endpointTypes?.length) {
        continue
      }
      if (field === 'name' && keepFetchedName) {
        continue
      }
      const value = registry[field]
      if (value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0)) {
        Object.assign(merged, { [field]: value })
      }
    }

    return merged
  })
}

/**
 * Sync provider models: ask main to list upstream models (main reads keys
 * from DB), then enrich via the registry-resolve endpoint. `throwOnError`
 * surfaces upstream failures so the UI can show a real reason rather than
 * a silent empty list.
 */
export async function fetchResolvedProviderModels(providerId: string): Promise<ListedModels<Model>> {
  try {
    logger.info('Fetching provider models via IPC', { providerId })
    const { models: fetched, skippedModels } = await ipcApi.request('ai.provider.model.list', {
      providerId,
      throwOnError: true
    })
    logger.info('Fetched provider models', { providerId, fetchedModelCount: fetched.length })
    // Enrichment rebuilds the array, so the notice main reported alongside the
    // models is carried onto the result.
    const models = await enrichFetchedModels(providerId, fetched)
    return skippedModels ? { models, skippedModels } : { models }
  } catch (error) {
    logger.error('Failed to fetch and resolve provider models', {
      providerId,
      errorType: error instanceof Error ? error.name : typeof error
    })
    throw error
  }
}
