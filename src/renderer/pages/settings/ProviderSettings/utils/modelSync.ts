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
  parseUniqueModelId,
  type RuntimeReasoning
} from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isNewApiProvider } from '@shared/utils/provider'

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

const resolveModelsPath = (providerId: string): ProviderResolveModelsPath => `/providers/${providerId}/models:resolve`

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
  const capabilities = !model.presetModelId && model.capabilities?.length ? model.capabilities : undefined
  // Provider-declared reasoning (OpenRouter's per-model effort vocabulary) is the
  // only descriptor an unregistered model has. It has to travel with the DTO:
  // the main-process create path otherwise stores `reasoning = NULL`, and every
  // effort the user picks is then dropped by the request pipeline.
  const reasoning =
    model.reasoning && (model.reasoning.controls?.length || model.reasoning.selectableEfforts?.length)
      ? { ...model.reasoning }
      : undefined

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
    ...(reasoning ? { reasoning } : {})
  }
}

/** How long the optional provider catalog may hold up a manual add before it is abandoned. */
export const PROVIDER_REASONING_LOOKUP_TIMEOUT_MS = 2000

/**
 * Provider-declared reasoning for manually added models, keyed by raw model id.
 *
 * The registry authors the descriptor for the models it knows, and `models:resolve` answers that
 * without leaving SQLite. Everything else has only the provider's catalog, which is remote and
 * therefore runs behind the AI IPC route — never on the DataApi create request, whose network-free
 * path is what keeps the write inside its 3s renderer deadline.
 *
 * The catalog is enrichment, so it is bounded: a provider that never answers must not hold the
 * form in its submitting state. IPC invoke cannot be cancelled, so the deadline abandons the
 * response rather than the request.
 */
export async function resolveProviderReasoningForManualAdd(
  providerId: string,
  modelIds: readonly string[]
): Promise<Map<string, RuntimeReasoning>> {
  const reasonings = new Map<string, RuntimeReasoning>()
  const ids = [...new Set(modelIds.filter(Boolean))]
  if (ids.length === 0) {
    return reasonings
  }

  const unresolved: string[] = []
  try {
    const resolved = (await dataApiService.get(resolveModelsPath(providerId), { query: { ids } })) as Model[]
    const resolvedById = new Map(resolved.map((model) => [model.apiModelId ?? '', model]))
    for (const id of ids) {
      // A registry identity outranks the provider's declaration; an unmatched id carries
      // only an id-heuristic guess, which the provider's own declaration replaces.
      if (resolvedById.get(id)?.presetModelId) {
        continue
      }
      unresolved.push(id)
    }
  } catch (error) {
    logger.warn('Registry resolve failed for a manual model add; falling back to provider metadata', {
      providerId,
      error
    })
    unresolved.push(...ids)
  }

  if (unresolved.length === 0) {
    return reasonings
  }

  try {
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const { models } = await Promise.race([
      ipcApi.request('ai.provider.model.list', { providerId }),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('provider catalog lookup timed out')),
          PROVIDER_REASONING_LOOKUP_TIMEOUT_MS
        )
      })
    ]).finally(() => clearTimeout(timeoutId))

    const modelsById = new Map(models.map((model) => [model.apiModelId ?? '', model]))
    for (const id of unresolved) {
      const reasoning = modelsById.get(id)?.reasoning
      if (reasoning?.controls?.length || reasoning?.selectableEfforts?.length) {
        reasonings.set(id, reasoning)
      }
    }
  } catch (error) {
    // A provider with no key, an offline host, or a stalled catalog must not block a manual add.
    logger.warn('Provider model lookup failed for a manual model add; storing without provider reasoning', {
      providerId,
      error
    })
  }

  return reasonings
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

  const resolved = (await dataApiService.get(resolveModelsPath(providerId), {
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
      // A synthesized custom model (no preset identity) only carries an
      // id-heuristic reasoning guess; the provider's own declaration wins there.
      if (field === 'reasoning' && !registry.presetModelId && base.reasoning) {
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
