import { application } from '@application'
import type { FileProcessorFeature, FileProcessorId, PreferenceKeyType } from '@shared/data/preference/preferenceTypes'
import { type FileProcessorMerged, PRESETS_FILE_PROCESSORS } from '@shared/data/presets/fileProcessing'

import { processorRegistry } from '../processors/registry'
import { resolveDefaultImageToTextProcessor } from './defaultImageToTextProcessor'

const DEFAULT_PROCESSOR_KEY_BY_FEATURE = {
  document_to_markdown: 'feature.file_processing.default_document_to_markdown',
  image_to_text: 'feature.file_processing.default_image_to_text'
} as const satisfies Record<FileProcessorFeature, PreferenceKeyType>

function getFileProcessorById(processorId: FileProcessorId) {
  const processor = PRESETS_FILE_PROCESSORS.find((item) => item.id === processorId)

  if (!processor) {
    throw new Error(`File processor not found: ${processorId}`)
  }

  return processor
}

export function getFileProcessorConfigById(processorId: FileProcessorId): FileProcessorMerged {
  const processor = getFileProcessorById(processorId)
  const override = application.get('PreferenceService').get('feature.file_processing.overrides')?.[processorId]

  return {
    id: processor.id,
    type: processor.type,
    capabilities: processor.capabilities.map((capability) => {
      const capabilityOverride = override?.capabilities?.[capability.feature]

      return {
        ...capability,
        ...(capabilityOverride?.apiHost !== undefined ? { apiHost: capabilityOverride.apiHost } : {}),
        ...(capabilityOverride?.modelId !== undefined ? { modelId: capabilityOverride.modelId } : {})
      }
    }),
    apiKeys: override?.apiKeys,
    options: override?.options
  }
}

function assertProcessorUsable(config: FileProcessorMerged, feature: FileProcessorFeature): void {
  if (!config.capabilities.some((capability) => capability.feature === feature)) {
    throw new Error(`File processor ${config.id} does not support ${feature}`)
  }

  if (!processorRegistry[config.id].isAvailable()) {
    throw new Error(`File processor ${config.id} is not available on this platform`)
  }
}

export function resolveProcessorConfigByFeature(
  feature: FileProcessorFeature,
  processorId?: FileProcessorId
): FileProcessorMerged {
  if (processorId) {
    const config = getFileProcessorConfigById(processorId)
    assertProcessorUsable(config, feature)
    return config
  }

  const defaultProcessorId =
    application.get('PreferenceService').get(DEFAULT_PROCESSOR_KEY_BY_FEATURE[feature]) ??
    resolveFeatureFallbackProcessor(feature)

  if (defaultProcessorId) {
    const config = getFileProcessorConfigById(defaultProcessorId)
    assertProcessorUsable(config, feature)
    return config
  }

  throw new Error(`Default file processor for ${feature} is not configured`)
}

/**
 * Resolve-time fallback for features that have a sensible platform default but no
 * configured one. `image_to_text` defaults to system OCR on macOS/Windows and
 * tesseract on Linux. Computing this here (instead of persisting it on startup)
 * keeps the default self-healing: a profile created on one OS and restored on
 * another never carries a persisted-but-unavailable processor id.
 */
function resolveFeatureFallbackProcessor(feature: FileProcessorFeature): FileProcessorId | null {
  return feature === 'image_to_text' ? resolveDefaultImageToTextProcessor() : null
}
