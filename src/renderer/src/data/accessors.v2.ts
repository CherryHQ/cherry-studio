import { dataApiService } from '@data/DataApiService'
import { DataApiError, ErrorCode } from '@shared/data/api/apiErrors'
import type { Model } from '@shared/data/types/model'
import { parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

function isNotFoundError(e: unknown): boolean {
  return e instanceof DataApiError && e.code === ErrorCode.NOT_FOUND
}

export async function getProvidersAsync(): Promise<Provider[]> {
  return dataApiService.get('/providers' as const)
}

export async function getEnabledProvidersAsync(): Promise<Provider[]> {
  return dataApiService.get('/providers' as const, { query: { enabled: true } })
}

export async function getProviderByIdAsync(id: string): Promise<Provider | undefined> {
  try {
    return await dataApiService.get(`/providers/${id}` as const)
  } catch (e) {
    if (isNotFoundError(e)) return undefined
    throw e
  }
}

export async function getModelAsync(providerId: string, modelId: string): Promise<Model | undefined> {
  try {
    return await dataApiService.get(`/models/${providerId}/${modelId}` as any)
  } catch (e) {
    if (isNotFoundError(e)) return undefined
    throw e
  }
}

export async function getModelByUniqueIdAsync(uniqueModelId: UniqueModelId): Promise<Model | undefined> {
  const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
  return getModelAsync(providerId, modelId)
}
