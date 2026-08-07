import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import type { CreateModelDto } from '@shared/data/api/schemas/models'
import type { ProviderPreset } from '@shared/data/api/schemas/providers'
import type { ConcreteApiPaths } from '@shared/data/api/types'
import {
  type EndpointType as RuntimeEndpointType,
  type Model,
  MODEL_CAPABILITY,
  parseUniqueModelId
} from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isNewApiProvider } from '@shared/utils/provider'
import { isEmpty } from 'es-toolkit/compat'

const logger = loggerService.withContext('ProviderModelSync')

export type ModelSyncErrorCode = 'NO_ENABLED_API_KEY'

export class ModelSyncError extends Error {
  constructor(
    message: string,
    public readonly code: ModelSyncErrorCode,
    public readonly meta?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'ModelSyncError'
  }
}

type ProviderResolveModelsPath = Extract<ConcreteApiPaths, `/providers/${string}/models:resolve`>
type ProviderPresetPath = Extract<ConcreteApiPaths, `/providers/${string}/preset`>
type ModelSyncProviderEndpointSource = Pick<Provider, 'id' | 'presetProviderId' | 'defaultChatEndpoint'>

export function resolveCreateModelEndpointTypes(
  provider: ModelSyncProviderEndpointSource | null | undefined,
  model: Pick<Model, 'endpointTypes'>
): RuntimeEndpointType[] | undefined {
  if (model.endpointTypes?.length) {
    return [...model.endpointTypes]
  }

  if (!provider || !isNewApiProvider(provider as Provider)) {
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
  const capabilities =
    model.reasoning && model.capabilities.includes(MODEL_CAPABILITY.REASONING)
      ? [MODEL_CAPABILITY.REASONING]
      : undefined

  return {
    providerId,
    modelId,
    name: model.name,
    group: model.group,
    ...(capabilities ? { capabilities } : {}),
    ...(resolvedEndpointTypes?.length ? { endpointTypes: [...resolvedEndpointTypes] } : {})
  }
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

  const resolveModelsPath: ProviderResolveModelsPath = `/providers/${providerId}/models:resolve`
  const resolved = (await dataApiService.get(resolveModelsPath, {
    query: {
      ids: filteredModels.map((model) => model.apiModelId ?? '').filter(Boolean)
    }
  })) as Model[]

  const resolvedMap = new Map<string, Model>()
  for (const model of resolved) {
    const key = model.apiModelId ?? parseUniqueModelId(model.id).modelId
    if (!resolvedMap.has(key)) {
      resolvedMap.set(key, model)
    }
  }

  const REGISTRY_FIELDS = [
    'name',
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

  return filteredModels.map((fetched) => {
    const base = fetched as Model
    const apiId = fetched.apiModelId ?? ''
    // `resolveModels` keys every result by the exact raw id it was sent, so an exact lookup always hits —
    // no fuzzy fallback needed (a slash/dot-stripping fallback used to overlay siblings onto one canonical
    // row, collapsing their distinct display names).
    const registry = resolvedMap.get(apiId)

    if (!registry) {
      return base
    }

    const merged = { ...base }
    // An unmatched (custom) resolved row only carries a prettified id as its name. If the provider's
    // /models returned a real display name — one that differs from the raw id — keep it instead of
    // overwriting with the prettified id. Matched rows (presetModelId set) own the curated name.
    const keepFetchedName = !registry.presetModelId && !!base.name && base.name !== base.apiModelId

    for (const field of REGISTRY_FIELDS) {
      if (field === 'endpointTypes' && base.endpointTypes?.length) {
        continue
      }
      if (field === 'name' && keepFetchedName) {
        continue
      }

      const value = registry[field]
      if (value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0)) {
        ;(merged as Record<string, unknown>)[field] = value
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
export async function fetchResolvedProviderModels(providerId: string): Promise<Model[]> {
  try {
    logger.info('Fetching provider models via IPC', { providerId })
    const fetched = await ipcApi.request('ai.provider.model.list', { providerId, throwOnError: true })
    logger.info('Fetched provider models', { providerId, fetchedModelCount: fetched.length })
    return await enrichFetchedModels(providerId, fetched)
  } catch (error) {
    logger.error('Failed to fetch and resolve provider models', { providerId, error })
    throw error
  }
}

export async function fetchProviderCatalogModels(providerId: string): Promise<Model[]> {
  const presetPath: ProviderPresetPath = `/providers/${providerId}/preset`
  const preset = (await dataApiService.get(presetPath, { query: { fields: 'models' } })) as ProviderPreset
  return preset.models ?? []
}
