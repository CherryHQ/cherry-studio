import { isEmpty } from 'es-toolkit/compat'

import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
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
import { SystemProviderIds } from '@shared/utils/systemProviderId'

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

/** Providers whose own model listing is the source of truth for limits and prices (not the registry snapshot). */
const LIVE_CATALOG_PROVIDERS: ReadonlySet<string> = new Set([SystemProviderIds.dothoosh])

const savesListedLimits = (providerId: string, model: Pick<Model, 'presetModelId'>): boolean =>
  !model.presetModelId || LIVE_CATALOG_PROVIDERS.has(providerId)

export function toCreateModelDto(
  providerId: string,
  model: Model,
  endpointTypes?: RuntimeEndpointType[]
): CreateModelDto {
  const modelId = getRawModelId(model)
  const resolvedEndpointTypes = endpointTypes?.length ? endpointTypes : model.endpointTypes
  const capabilities = !model.presetModelId && model.capabilities?.length ? model.capabilities : undefined

  return {
    providerId,
    modelId,
    name: model.name,
    group: model.group,
    ...(capabilities ? { capabilities: [...capabilities] } : {}),
    ...(resolvedEndpointTypes?.length ? { endpointTypes: [...resolvedEndpointTypes] } : {}),
    // Discovered rather than registry-supplied for local providers — Ollama's window comes from
    // `/api/show`, and dropping it here leaves the row without one, so no `num_ctx` is ever sent.
    ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
    // A model unknown to the registry saves its listed limit and prices; a preset-backed one resolves them
    // from the registry, except on a live-catalog provider whose listing is newer.
    ...(savesListedLimits(providerId, model) && model.maxOutputTokens
      ? { maxOutputTokens: model.maxOutputTokens }
      : {}),
    ...(savesListedLimits(providerId, model) && model.pricing ? { pricing: model.pricing } : {})
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

  // A live-catalog provider's own listing is newer than the registry snapshot: it wins, and the registry
  // only fills what the listing left out. Every other provider keeps registry-over-listing precedence.
  const LIVE_FIELDS = new Set<string>(
    LIVE_CATALOG_PROVIDERS.has(providerId) ? ['contextWindow', 'maxOutputTokens', 'maxInputTokens', 'pricing'] : []
  )

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
    // Fetchers use the raw id when the API has no display name; only then use the registry name.
    const keepFetchedName = !!base.name && base.name !== base.apiModelId

    for (const field of REGISTRY_FIELDS) {
      if (field === 'endpointTypes' && base.endpointTypes?.length) {
        continue
      }
      if (field === 'name' && keepFetchedName) {
        continue
      }
      if (LIVE_FIELDS.has(field) && base[field] != null) {
        continue
      }
      const value = registry[field]
      if (value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0)) {
        ;(merged as Record<string, unknown>)[field] = value
      }
    }

    // A registry input cap that no longer fits under the live context window is dropped, not shown
    // next to a smaller window.
    if (
      base.maxInputTokens == null &&
      merged.maxInputTokens != null &&
      merged.contextWindow != null &&
      merged.maxInputTokens > merged.contextWindow
    ) {
      delete merged.maxInputTokens
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
