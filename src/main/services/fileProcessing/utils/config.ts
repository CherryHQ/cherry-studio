import { application } from '@main/core/application'
import type {
  FileProcessorCapabilityOverride,
  FileProcessorFeature,
  FileProcessorId,
  FileProcessorOverrides,
  PreferenceDefaultScopeType,
  PreferenceKeyType
} from '@shared/data/preference/preferenceTypes'
import { type FileProcessorMerged, PRESETS_FILE_PROCESSORS } from '@shared/data/presets/file-processing'

export interface FileProcessingPreferenceReader {
  get<K extends PreferenceKeyType>(key: K): PreferenceDefaultScopeType[K] | Promise<PreferenceDefaultScopeType[K]>
}

export interface ResolveProcessorConfigInput {
  feature: FileProcessorFeature
  processorId?: FileProcessorId
}

const DEFAULT_PROCESSOR_KEY_BY_FEATURE = {
  markdown_conversion: 'feature.file_processing.default_markdown_conversion',
  text_extraction: 'feature.file_processing.default_text_extraction'
} as const

function mergeCapabilityConfig<T extends { apiHost?: string; modelId?: string }>(
  capability: T,
  override?: FileProcessorCapabilityOverride
): T {
  return {
    ...capability,
    ...(override?.apiHost !== undefined ? { apiHost: override.apiHost } : {}),
    ...(override?.modelId !== undefined ? { modelId: override.modelId } : {})
  }
}

function supportsFeature(processorId: FileProcessorId, feature: FileProcessorFeature): boolean {
  const preset = PRESETS_FILE_PROCESSORS.find((preset) => preset.id === processorId)
  return Boolean(preset?.capabilities.some((capability) => capability.feature === feature))
}

function mergeProcessorConfig(processorId: FileProcessorId, overrides: FileProcessorOverrides): FileProcessorMerged {
  const preset = PRESETS_FILE_PROCESSORS.find((preset) => preset.id === processorId)

  if (!preset) {
    throw new Error(`Unknown file processor: ${processorId}`)
  }

  const override = overrides[processorId]

  return {
    id: preset.id,
    type: preset.type,
    capabilities: preset.capabilities.map((capability) =>
      mergeCapabilityConfig(capability, override?.capabilities?.[capability.feature])
    ),
    apiKeys: override?.apiKeys,
    options: override?.options
  }
}

async function resolveProcessorId(
  feature: FileProcessorFeature,
  processorId?: FileProcessorId
): Promise<FileProcessorId> {
  const preferences = application.get('PreferenceService')
  if (processorId) {
    if (!supportsFeature(processorId, feature)) {
      throw new Error(`File processor ${processorId} does not support ${feature}`)
    }

    return processorId
  }

  const defaultProcessorId = preferences.get(DEFAULT_PROCESSOR_KEY_BY_FEATURE[feature])

  if (defaultProcessorId) {
    if (!supportsFeature(defaultProcessorId, feature)) {
      throw new Error(`File processor ${defaultProcessorId} does not support ${feature}`)
    }

    return defaultProcessorId
  }

  throw new Error(`Default file processor for ${feature} is not configured`)
}

export async function resolveProcessorConfig(
  feature: FileProcessorFeature,
  processorId?: FileProcessorId
): Promise<FileProcessorMerged> {
  const preferences = application.get('PreferenceService')
  const [resolvedProcessorId, overrides] = await Promise.all([
    resolveProcessorId(feature, processorId),
    preferences.get('feature.file_processing.overrides')
  ])

  return mergeProcessorConfig(resolvedProcessorId, overrides)
}
