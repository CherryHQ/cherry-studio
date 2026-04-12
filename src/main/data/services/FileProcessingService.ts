import { application } from '@application'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type {
  FileProcessorFeature,
  FileProcessorId,
  FileProcessorOverride,
  FileProcessorOverrides,
  PreferenceKeyType
} from '@shared/data/preference/preferenceTypes'
import { FILE_PROCESSOR_FEATURES, type FileProcessorCapabilityOverride } from '@shared/data/preference/preferenceTypes'
import { type FileProcessorMerged, PRESETS_FILE_PROCESSORS } from '@shared/data/presets/file-processing'

import { mergeProcessorPreset } from '../../services/fileProcessing/config/mergeProcessorPreset'

const logger = loggerService.withContext('DataApi:FileProcessingService')
const DEFAULT_PROCESSOR_KEY_BY_FEATURE = {
  markdown_conversion: 'feature.file_processing.default_markdown_conversion',
  text_extraction: 'feature.file_processing.default_text_extraction'
} as const satisfies Record<FileProcessorFeature, PreferenceKeyType>

function isFileProcessorFeature(value: string): value is FileProcessorFeature {
  return FILE_PROCESSOR_FEATURES.includes(value as FileProcessorFeature)
}

function mergeCapabilityOverrides(
  current?: Partial<Record<FileProcessorFeature, FileProcessorCapabilityOverride>>,
  updates?: Partial<Record<FileProcessorFeature, FileProcessorCapabilityOverride>>
): Partial<Record<FileProcessorFeature, FileProcessorCapabilityOverride>> | undefined {
  if (!current && !updates) {
    return undefined
  }

  const merged: Partial<Record<FileProcessorFeature, FileProcessorCapabilityOverride>> = {}

  for (const source of [current, updates]) {
    for (const [key, override] of Object.entries(source ?? {})) {
      if (!isFileProcessorFeature(key) || !override) {
        continue
      }

      merged[key] = {
        ...merged[key],
        ...override
      }
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined
}

function mergeProcessorOverrides(
  current?: FileProcessorOverride,
  updates?: FileProcessorOverride
): FileProcessorOverride {
  const currentRest: Partial<FileProcessorOverride> = current ? { ...current } : {}
  const updateRest: Partial<FileProcessorOverride> = updates ? { ...updates } : {}
  const mergedCapabilities = mergeCapabilityOverrides(current?.capabilities, updates?.capabilities)
  const mergedOptions =
    current?.options || updates?.options
      ? {
          ...current?.options,
          ...updates?.options
        }
      : undefined

  delete currentRest.capabilities
  delete currentRest.options
  delete updateRest.capabilities
  delete updateRest.options

  return {
    ...currentRest,
    ...updateRest,
    ...(mergedCapabilities && Object.keys(mergedCapabilities).length > 0 ? { capabilities: mergedCapabilities } : {}),
    ...(mergedOptions && Object.keys(mergedOptions).length > 0 ? { options: mergedOptions } : {})
  }
}

export class FileProcessingService {
  public async getProcessors(): Promise<FileProcessorMerged[]> {
    const overrides = this.getOverrides()

    return PRESETS_FILE_PROCESSORS.map((preset) => this.mergeProcessorConfig(preset.id, overrides))
  }

  public async resolveProcessorByFeature(
    feature: FileProcessorFeature,
    processorId?: FileProcessorId
  ): Promise<FileProcessorMerged> {
    const resolvedProcessorId = this.resolveProcessorId(feature, processorId)

    return this.mergeProcessorConfig(resolvedProcessorId, this.getOverrides())
  }

  public async getProcessorById(id: FileProcessorId): Promise<FileProcessorMerged> {
    return this.mergeProcessorConfig(id, this.getOverrides())
  }

  public async updateProcessor(id: FileProcessorId, updates: FileProcessorOverride): Promise<FileProcessorMerged> {
    this.getPresetById(id)

    const overrides = this.getOverrides()
    const nextOverrides: FileProcessorOverrides = {
      ...overrides,
      [id]: mergeProcessorOverrides(overrides[id], updates)
    }

    await application.get('PreferenceService').set('feature.file_processing.overrides', nextOverrides)

    logger.info('Updated file processor overrides', {
      processorId: id,
      hasApiKeys: Boolean(nextOverrides[id]?.apiKeys?.length),
      capabilityCount: Object.keys(nextOverrides[id]?.capabilities || {}).length
    })

    return this.mergeProcessorConfig(id, nextOverrides)
  }

  private getOverrides(): FileProcessorOverrides {
    return application.get('PreferenceService').get('feature.file_processing.overrides') ?? {}
  }

  private getPresetById(processorId: FileProcessorId) {
    const preset = PRESETS_FILE_PROCESSORS.find((item) => item.id === processorId)

    if (!preset) {
      throw DataApiErrorFactory.notFound('File processor', processorId)
    }

    return preset
  }

  private resolveProcessorId(feature: FileProcessorFeature, processorId?: FileProcessorId): FileProcessorId {
    if (processorId) {
      if (!this.supportsFeature(processorId, feature)) {
        throw new Error(`File processor ${processorId} does not support ${feature}`)
      }

      return processorId
    }

    const defaultProcessorId = application.get('PreferenceService').get(DEFAULT_PROCESSOR_KEY_BY_FEATURE[feature])

    if (defaultProcessorId) {
      if (!this.supportsFeature(defaultProcessorId, feature)) {
        throw new Error(`File processor ${defaultProcessorId} does not support ${feature}`)
      }

      return defaultProcessorId
    }

    throw new Error(`Default file processor for ${feature} is not configured`)
  }

  private supportsFeature(processorId: FileProcessorId, feature: FileProcessorFeature): boolean {
    const preset = PRESETS_FILE_PROCESSORS.find((item) => item.id === processorId)
    return Boolean(preset?.capabilities.some((capability) => capability.feature === feature))
  }

  private mergeProcessorConfig(processorId: FileProcessorId, overrides: FileProcessorOverrides): FileProcessorMerged {
    const preset = this.getPresetById(processorId)

    return mergeProcessorPreset(preset, overrides[processorId])
  }
}

export const fileProcessingService = new FileProcessingService()
