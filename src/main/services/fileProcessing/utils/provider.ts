import type { FileProcessorFeature, FileProcessorId } from '@shared/data/preference/preferenceTypes'
import type { FileProcessorFeatureCapability, FileProcessorMerged } from '@shared/data/presets/file-processing'

const lastUsedKeyByProcessor = new Map<FileProcessorId, string>()

export function assertHasFilePath<T extends { path?: string | null }>(file: T): asserts file is T & { path: string } {
  if (!file.path) {
    throw new Error('File path is required')
  }
}

export function getRequiredCapability(
  config: FileProcessorMerged,
  feature: FileProcessorFeature,
  processorId: FileProcessorId
): FileProcessorFeatureCapability {
  const capability = config.capabilities.find((item) => item.feature === feature)

  if (!capability) {
    throw new Error(`Processor ${processorId} is missing ${feature} capability`)
  }

  return capability
}

export function getApiKey(config: FileProcessorMerged, processorId: FileProcessorId): string | undefined {
  const keys = config.apiKeys?.map((value) => value.trim()).filter(Boolean) ?? []

  if (keys.length === 0) {
    return undefined
  }

  if (keys.length === 1) {
    return keys[0]
  }

  const lastUsedKey = lastUsedKeyByProcessor.get(processorId)
  const currentIndex = lastUsedKey ? keys.indexOf(lastUsedKey) : -1
  const nextIndex = (currentIndex + 1) % keys.length
  const nextKey = keys[nextIndex]

  lastUsedKeyByProcessor.set(processorId, nextKey)
  return nextKey
}

export function getRequiredApiKey(config: FileProcessorMerged, processorId: FileProcessorId): string {
  const apiKey = getApiKey(config, processorId)

  if (!apiKey) {
    throw new Error('API key is required')
  }

  return apiKey
}

export function getRequiredApiHost(capability: Pick<FileProcessorFeatureCapability, 'apiHost'>): string {
  const normalizedApiHost = capability.apiHost?.trim().replace(/\/+$/, '')

  if (!normalizedApiHost) {
    throw new Error('API host is required')
  }

  return normalizedApiHost
}
