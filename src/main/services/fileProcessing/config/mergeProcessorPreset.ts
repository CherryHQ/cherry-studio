import type { FileProcessorCapabilityOverride, FileProcessorOverride } from '@shared/data/preference/preferenceTypes'
import type { FileProcessorMerged, PRESETS_FILE_PROCESSORS } from '@shared/data/presets/file-processing'

type FileProcessorPreset = (typeof PRESETS_FILE_PROCESSORS)[number]

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

export function mergeProcessorPreset(
  preset: FileProcessorPreset,
  override?: FileProcessorOverride
): FileProcessorMerged {
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
