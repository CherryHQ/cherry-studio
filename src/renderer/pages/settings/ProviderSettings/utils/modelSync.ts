import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import type { CreateModelDto } from '@shared/data/api/schemas/models'
import type { ProviderPreset } from '@shared/data/api/schemas/providers'
import type { ConcreteApiPaths } from '@shared/data/api/types'
import { type EndpointType as RuntimeEndpointType, type Model, parseUniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

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

type ProviderPresetPath = Extract<ConcreteApiPaths, `/providers/${string}/preset`>
type ModelSyncProviderEndpointSource = Pick<Provider, 'defaultChatEndpoint' | 'modelListApi'>

export function resolveCreateModelEndpointTypes(
  provider: ModelSyncProviderEndpointSource | null | undefined,
  model: Pick<Model, 'endpointTypes'>
): RuntimeEndpointType[] | undefined {
  if (model.endpointTypes?.length) {
    return [...model.endpointTypes]
  }

  if (provider?.modelListApi?.type !== 'new-api') {
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

  return {
    providerId,
    modelId,
    name: model.name,
    group: model.group,
    ...(capabilities ? { capabilities: [...capabilities] } : {}),
    ...(resolvedEndpointTypes?.length ? { endpointTypes: [...resolvedEndpointTypes] } : {}),
    // Discovered rather than registry-supplied for local providers — Ollama's window comes from
    // `/api/show`, and dropping it here leaves the row without one, so no `num_ctx` is ever sent.
    ...(model.contextWindow ? { contextWindow: model.contextWindow } : {})
  }
}

/**
 * Sync provider models through Main, which owns upstream discovery, registry
 * resolution, and runtime pricing. `throwOnError` surfaces upstream failures
 * so the UI can show a real reason rather than a silent empty list.
 */
export async function fetchResolvedProviderModels(providerId: string): Promise<Model[]> {
  try {
    logger.info('Fetching provider models via IPC', { providerId })
    const fetched = await ipcApi.request('ai.provider.model.list', { providerId, throwOnError: true })
    logger.info('Fetched provider models', { providerId, fetchedModelCount: fetched.length })
    return fetched
  } catch (error) {
    logger.error('Failed to fetch and resolve provider models', {
      providerId,
      errorType: error instanceof Error ? error.name : typeof error
    })
    throw error
  }
}

export async function fetchProviderCatalogModels(providerId: string): Promise<Model[]> {
  const presetPath: ProviderPresetPath = `/providers/${providerId}/preset`
  const preset = (await dataApiService.get(presetPath, { query: { fields: 'models' } })) as ProviderPreset
  return preset.models ?? []
}
