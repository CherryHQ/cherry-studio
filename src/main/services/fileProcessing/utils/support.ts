import type { FileProcessorFeature } from '@shared/data/preference/preferenceTypes'
import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import { FILE_TYPE, type FileInfo, type FileType } from '@shared/file/types'

export function assertFeatureSupportsFileInfo(file: FileInfo, feature: FileProcessorFeature): void {
  if (feature === 'image_to_text' && file.type !== FILE_TYPE.IMAGE) {
    throw new Error(`File processing ${feature} only supports image files`)
  }

  if (feature === 'document_to_markdown' && file.type !== FILE_TYPE.DOCUMENT) {
    throw new Error(`File processing ${feature} only supports document files`)
  }
}

export function assertProcessorSupportsFileType(
  fileType: FileType,
  feature: FileProcessorFeature,
  config: FileProcessorMerged
): void {
  const presetCapability = config.capabilities.find((item) => item.feature === feature)

  if (!presetCapability) {
    throw new Error(`File processor ${config.id} does not support ${feature}`)
  }

  const supportedInputs: readonly FileType[] = presetCapability.inputs

  if (!supportedInputs.includes(fileType)) {
    throw new Error(`File processor ${config.id} ${feature} does not support ${fileType} files`)
  }
}
