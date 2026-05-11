import { loggerService } from '@logger'
import {
  FILE_PROCESSOR_IDS,
  type FileProcessorCapabilityOverride,
  type FileProcessorFeature,
  type FileProcessorId,
  type FileProcessorOverride,
  type FileProcessorOverrides
} from '@shared/data/preference/preferenceTypes'
import { getFileProcessorPresetById } from '@shared/data/utils/fileProcessingUtils'

import type { TransformResult } from './ComplexPreferenceMappings'

const logger = loggerService.withContext('Migration:FileProcessingOverrideMappings')

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFileProcessorId(value: unknown): value is FileProcessorId {
  return typeof value === 'string' && FILE_PROCESSOR_IDS.includes(value as FileProcessorId)
}

function ensureOverride(overrides: FileProcessorOverrides, id: FileProcessorId): FileProcessorOverride {
  overrides[id] ??= {}
  return overrides[id]
}

function ensureCapability(
  override: FileProcessorOverride,
  feature: FileProcessorFeature
): FileProcessorCapabilityOverride {
  override.capabilities ??= {}

  const existingCapability = override.capabilities[feature]
  if (existingCapability) {
    return existingCapability
  }

  const nextCapability: FileProcessorCapabilityOverride = {}
  override.capabilities[feature] = nextCapability
  return nextCapability
}

function mergeOptions(override: FileProcessorOverride, options: Record<string, unknown>) {
  if (Object.keys(options).length === 0) {
    return
  }

  override.options = {
    ...(isRecord(override.options) ? override.options : {}),
    ...options
  }
}

function addApiKey(override: FileProcessorOverride, apiKey: unknown) {
  if (!isNonEmptyString(apiKey)) {
    return
  }

  override.apiKeys ??= []
  if (!override.apiKeys.includes(apiKey)) {
    override.apiKeys.push(apiKey)
  }
}

function getPresetCapability(processorId: FileProcessorId, feature: FileProcessorFeature) {
  const processor = getFileProcessorPresetById(processorId)
  const capability = processor?.capabilities.find((item) => item.feature === feature)

  return {
    apiHost: capability && 'apiHost' in capability ? capability.apiHost : undefined,
    modelId: capability && 'modelId' in capability ? capability.modelId : undefined
  }
}

function resolvePreprocessFeature(processorId: FileProcessorId): FileProcessorFeature {
  const processor = getFileProcessorPresetById(processorId)!

  if (processor.capabilities.some((capability) => capability.feature === 'document_to_markdown')) {
    return 'document_to_markdown'
  }

  return 'image_to_text'
}

function resolvePreprocessFeatures(processorId: FileProcessorId): FileProcessorFeature[] {
  if (processorId === 'mistral') {
    return ['document_to_markdown', 'image_to_text']
  }

  return [resolvePreprocessFeature(processorId)]
}

function setCapabilityApiHost(
  override: FileProcessorOverride,
  processorId: FileProcessorId,
  feature: FileProcessorFeature,
  apiHost: unknown
) {
  if (!isNonEmptyString(apiHost)) {
    return
  }

  const presetApiHost = getPresetCapability(processorId, feature).apiHost
  if (apiHost === presetApiHost) {
    return
  }

  ensureCapability(override, feature).apiHost = apiHost
}

function setCapabilityModelId(
  override: FileProcessorOverride,
  processorId: FileProcessorId,
  feature: FileProcessorFeature,
  modelId: unknown
) {
  if (!isNonEmptyString(modelId)) {
    return
  }

  const presetModelId = getPresetCapability(processorId, feature).modelId
  if (modelId === presetModelId) {
    return
  }

  ensureCapability(override, feature).modelId = modelId
}

function normalizeLangs(value: unknown, providerId: FileProcessorId): string[] {
  if (Array.isArray(value)) {
    return value.filter(isNonEmptyString)
  }

  if (value === undefined || value === null) {
    return []
  }

  if (!isRecord(value)) {
    logger.warn('Skipping invalid OCR langs during file processing migration', {
      providerId,
      valueType: typeof value
    })
    return []
  }

  return Object.entries(value)
    .filter(([, enabled]) => enabled === true)
    .map(([lang]) => lang)
}

function pruneEmptyOverrides(overrides: FileProcessorOverrides) {
  for (const [processorId, override] of Object.entries(overrides)) {
    if (override.apiKeys?.length === 0) {
      delete override.apiKeys
    }

    if (override.capabilities) {
      for (const feature of Object.keys(override.capabilities) as FileProcessorFeature[]) {
        const capability = override.capabilities[feature]
        if (!capability || Object.keys(capability).length === 0) {
          delete override.capabilities[feature]
        }
      }

      if (Object.keys(override.capabilities).length === 0) {
        delete override.capabilities
      }
    }

    if (isRecord(override.options) && Object.keys(override.options).length === 0) {
      delete override.options
    }

    if (Object.keys(override).length === 0) {
      delete overrides[processorId as FileProcessorId]
    }
  }
}

function mergePreprocessProvider(overrides: FileProcessorOverrides, provider: unknown) {
  if (!isRecord(provider)) {
    return
  }

  const providerId = provider.id
  if (!isFileProcessorId(providerId)) {
    logger.warn('Skipping unknown preprocess provider during file processing migration', {
      providerId: typeof providerId === 'string' ? providerId : undefined
    })
    return
  }

  const override = ensureOverride(overrides, providerId)
  const features = resolvePreprocessFeatures(providerId)

  addApiKey(override, provider.apiKey)

  if (providerId !== 'paddleocr') {
    for (const feature of features) {
      setCapabilityApiHost(override, providerId, feature, provider.apiHost)
      setCapabilityModelId(override, providerId, feature, provider.model)
    }
  }

  if (isRecord(provider.options)) {
    mergeOptions(override, provider.options)
  }
}

function mergeOcrProvider(overrides: FileProcessorOverrides, provider: unknown) {
  if (!isRecord(provider)) {
    return
  }

  const providerId = provider.id
  if (!isFileProcessorId(providerId)) {
    logger.warn('Skipping unknown OCR provider during file processing migration', {
      providerId: typeof providerId === 'string' ? providerId : undefined
    })
    return
  }

  const config = isRecord(provider.config) ? provider.config : undefined
  if (!config) {
    return
  }

  const override = ensureOverride(overrides, providerId)

  addApiKey(override, config.accessToken)
  if (providerId !== 'paddleocr') {
    setCapabilityApiHost(override, providerId, 'image_to_text', config.apiUrl)
  }

  const langs = normalizeLangs(config.langs, providerId)
  if (langs.length > 0) {
    mergeOptions(override, { langs })
  }

  if (isRecord(config.api)) {
    addApiKey(override, config.api.apiKey)
    if (providerId !== 'paddleocr') {
      setCapabilityApiHost(override, providerId, 'image_to_text', config.api.apiHost)
    }

    if (isNonEmptyString(config.api.apiVersion)) {
      mergeOptions(override, { apiVersion: config.api.apiVersion })
    }
  }
}

export function mergeFileProcessingOverrides(sources: {
  preprocessProviders?: unknown
  ocrProviders?: unknown
}): TransformResult {
  const overrides: FileProcessorOverrides = {}

  if (Array.isArray(sources.preprocessProviders)) {
    sources.preprocessProviders.forEach((provider) => mergePreprocessProvider(overrides, provider))
  }

  if (Array.isArray(sources.ocrProviders)) {
    sources.ocrProviders.forEach((provider) => mergeOcrProvider(overrides, provider))
  }

  pruneEmptyOverrides(overrides)

  return {
    'feature.file_processing.overrides': overrides
  }
}
