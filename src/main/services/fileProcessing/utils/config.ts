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
  input: ResolveProcessorConfigInput,
  preferences: FileProcessingPreferenceReader
): Promise<FileProcessorId> {
  if (input.processorId) {
    if (!supportsFeature(input.processorId, input.feature)) {
      throw new Error(`File processor ${input.processorId} does not support ${input.feature}`)
    }

    return input.processorId
  }

  const defaultProcessorId = await preferences.get(DEFAULT_PROCESSOR_KEY_BY_FEATURE[input.feature])

  if (defaultProcessorId) {
    if (!supportsFeature(defaultProcessorId, input.feature)) {
      throw new Error(`File processor ${defaultProcessorId} does not support ${input.feature}`)
    }

    return defaultProcessorId
  }

  throw new Error(`Default file processor for ${input.feature} is not configured`)
}

export async function resolveProcessorConfig(
  input: ResolveProcessorConfigInput,
  preferences: FileProcessingPreferenceReader
): Promise<FileProcessorMerged> {
  const [processorId, overrides] = await Promise.all([
    resolveProcessorId(input, preferences),
    preferences.get('feature.file_processing.overrides')
  ])

  return mergeProcessorConfig(processorId, overrides)
}
