import { application } from '@application'
import type {
  FileProcessorFeature,
  FileProcessorId,
  FileProcessorOverrides,
  PreferenceKeyType
} from '@shared/data/preference/preferenceTypes'
import { type FileProcessorMerged, PRESETS_FILE_PROCESSORS } from '@shared/data/presets/file-processing'

import { mergeProcessorPreset } from './mergeProcessorPreset'

const DEFAULT_PROCESSOR_KEY_BY_FEATURE = {
  document_to_markdown: 'feature.file_processing.default_document_to_markdown',
  image_to_text: 'feature.file_processing.default_image_to_text'
} as const satisfies Record<FileProcessorFeature, PreferenceKeyType>

function getOverrides(): FileProcessorOverrides {
  return application.get('PreferenceService').get('feature.file_processing.overrides') ?? {}
}

function getPresetById(processorId: FileProcessorId) {
  const preset = PRESETS_FILE_PROCESSORS.find((item) => item.id === processorId)

  if (!preset) {
    throw new Error(`File processor not found: ${processorId}`)
  }

  return preset
}

function supportsFeature(processorId: FileProcessorId, feature: FileProcessorFeature): boolean {
  const preset = PRESETS_FILE_PROCESSORS.find((item) => item.id === processorId)
  return Boolean(preset?.capabilities.some((capability) => capability.feature === feature))
}

export function getProcessorConfigById(processorId: FileProcessorId): FileProcessorMerged {
  const preset = getPresetById(processorId)
  const overrides = getOverrides()

  return mergeProcessorPreset(preset, overrides[processorId])
}

export function resolveProcessorConfigByFeature(
  feature: FileProcessorFeature,
  processorId?: FileProcessorId
): FileProcessorMerged {
  if (processorId) {
    if (!supportsFeature(processorId, feature)) {
      throw new Error(`File processor ${processorId} does not support ${feature}`)
    }

    return getProcessorConfigById(processorId)
  }

  const defaultProcessorId = application.get('PreferenceService').get(DEFAULT_PROCESSOR_KEY_BY_FEATURE[feature])

  if (defaultProcessorId) {
    if (!supportsFeature(defaultProcessorId, feature)) {
      throw new Error(`File processor ${defaultProcessorId} does not support ${feature}`)
    }

    return getProcessorConfigById(defaultProcessorId)
  }

  throw new Error(`Default file processor for ${feature} is not configured`)
}
