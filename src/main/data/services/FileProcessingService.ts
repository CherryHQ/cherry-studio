import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type {
  CapabilityOverride,
  FileProcessorFeature,
  FileProcessorId,
  FileProcessorOverride,
  FileProcessorOverrides
} from '@shared/data/preference/preferenceTypes'
import { type FileProcessorMerged, PRESETS_FILE_PROCESSORS } from '@shared/data/presets/file-processing'

const logger = loggerService.withContext('DataApi:FileProcessingService')

function mergeCapabilityOverrides(
  current?: Partial<Record<FileProcessorFeature, CapabilityOverride>>,
  updates?: Partial<Record<FileProcessorFeature, CapabilityOverride>>
): Partial<Record<FileProcessorFeature, CapabilityOverride>> | undefined {
  if (!current && !updates) {
    return undefined
  }

  const merged: Partial<Record<FileProcessorFeature, CapabilityOverride>> = { ...current }

  for (const feature of Object.keys(updates ?? {}) as FileProcessorFeature[]) {
    merged[feature] = {
      ...current?.[feature],
      ...updates?.[feature]
    }
  }

  return merged
}

function mergeProcessorOverrides(
  current?: FileProcessorOverride,
  updates?: FileProcessorOverride
): FileProcessorOverride {
  return {
    ...current,
    ...updates,
    capabilities: mergeCapabilityOverrides(current?.capabilities, updates?.capabilities),
    options: {
      ...current?.options,
      ...updates?.options
    }
  }
}

export class FileProcessingService {
  private static instance: FileProcessingService

  private constructor() {}

  public static getInstance(): FileProcessingService {
    if (!FileProcessingService.instance) {
      FileProcessingService.instance = new FileProcessingService()
    }

    return FileProcessingService.instance
  }

  public async getProcessors(): Promise<FileProcessorMerged[]> {
    const overrides = this.getOverrides()

    return PRESETS_FILE_PROCESSORS.map((preset) => this.mergeProcessorConfig(preset.id, overrides))
  }

  public async getProcessorById(id: FileProcessorId): Promise<FileProcessorMerged> {
    return this.mergeProcessorConfig(id, this.getOverrides())
  }

  public async updateProcessor(id: FileProcessorId, updates: FileProcessorOverride): Promise<FileProcessorMerged> {
    const overrides = this.getOverrides()
    const nextOverrides: FileProcessorOverrides = {
      ...overrides,
      [id]: mergeProcessorOverrides(overrides[id], updates)
    }

    this.getPresetById(id)

    await preferenceService.set('file_processing.overrides', nextOverrides)

    logger.info('Updated file processor overrides', {
      processorId: id,
      hasApiKeys: Boolean(nextOverrides[id]?.apiKeys?.length),
      capabilityCount: Object.keys(nextOverrides[id]?.capabilities || {}).length
    })

    return this.mergeProcessorConfig(id, nextOverrides)
  }

  private getOverrides(): FileProcessorOverrides {
    return preferenceService.get('file_processing.overrides') ?? {}
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
      capabilities: preset.capabilities.map((capability) => ({
        ...capability,
        ...override?.capabilities?.[capability.feature]
      })),
      apiKeys: override?.apiKeys,
      options: override?.options
    }
  }
}

export const fileProcessingService = FileProcessingService.getInstance()
