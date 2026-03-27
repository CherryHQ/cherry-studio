import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { DataApiErrorFactory } from '@shared/data/api'
import type {
  FileProcessorFeature,
  FileProcessorId,
  FileProcessorOverride,
  FileProcessorOverrides
} from '@shared/data/preference/preferenceTypes'
import { FILE_PROCESSOR_FEATURES, type FileProcessorCapabilityOverride } from '@shared/data/preference/preferenceTypes'
import { type FileProcessorMerged, PRESETS_FILE_PROCESSORS } from '@shared/data/presets/file-processing'

const logger = loggerService.withContext('DataApi:FileProcessingService')

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

export class FileProcessingService {
  public async getProcessors(): Promise<FileProcessorMerged[]> {
    const overrides = this.getOverrides()

    return PRESETS_FILE_PROCESSORS.map((preset) => this.mergeProcessorConfig(preset.id, overrides))
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

  private mergeProcessorConfig(processorId: FileProcessorId, overrides: FileProcessorOverrides): FileProcessorMerged {
    const preset = this.getPresetById(processorId)
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
}

export const fileProcessingService = new FileProcessingService()
