import { stat as fsStat } from 'node:fs/promises'
import { readFile as fsReadFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type {
  FileProcessorFeature,
  FileProcessorId,
  FileProcessorOverride,
  FileProcessorOverrides
} from '@shared/data/preference/preferenceTypes'
import { FILE_PROCESSOR_FEATURES, type FileProcessorCapabilityOverride } from '@shared/data/preference/preferenceTypes'
import { type FileProcessorMerged, PRESETS_FILE_PROCESSORS } from '@shared/data/presets/file-processing'
import { FILE_TYPE } from '@shared/data/types/file'
import { extractPdfText } from '@shared/utils/pdf'
import type { ImageFileMetadata, OcrProvider } from '@types'
import { BuiltinOcrProviderIds } from '@types'

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

  // ============================================================================
  // Execution facade — single entry point for tools (e.g. fs__read) that need
  // to turn a file on disk into text, going through the user's configured
  // processor when one is selected and a sensible built-in default otherwise.
  //
  // The actual execution still routes to the existing per-backend services
  // (OcrService, pdf-parse, …); this facade exists so callers don't reach
  // into those services directly and stay decoupled from which backend a
  // user picks at runtime.
  // ============================================================================

  /**
   * Extract text from an image at `absolutePath`. Routes to the user's
   * configured `text_extraction` processor — falls back to built-in
   * tesseract when no preference is set, so the call works out of the box.
   */
  public async extractImageText(absolutePath: string): Promise<string> {
    const selectedId =
      application.get('PreferenceService').get('feature.file_processing.default_text_extraction') ?? null
    const processorId: FileProcessorId =
      selectedId && this.isOcrCapableProcessor(selectedId) ? selectedId : BuiltinOcrProviderIds.tesseract

    const ocrService = application.get('OcrService')
    const fileMeta = await this.makeImageFileMetadata(absolutePath)
    const ocrProvider: OcrProvider = {
      id: processorId,
      name: processorId,
      capabilities: { image: true }
    }
    const result = await ocrService.ocr(fileMeta, ocrProvider)
    return result.text
  }

  /**
   * Extract text from a PDF at `absolutePath`. PDF is the only format
   * that has a user-configurable `markdown_conversion` processor
   * (mineru / doc2x / mistral / open-mineru), so it earns this facade
   * — Office formats stay on officeparser at the call site, no
   * routing layer needed.
   *
   * Today this calls the built-in `pdf-parse` extractor. When a user
   * picks a non-default processor in settings, route through the
   * existing `PreprocessProvider` family from here without touching
   * call sites.
   */
  public async extractDocumentText(absolutePath: string): Promise<string> {
    const ext = extname(absolutePath).toLowerCase()
    if (ext !== '.pdf') {
      throw new Error(`extractDocumentText: unsupported extension ${ext} (only .pdf is routed through this facade)`)
    }
    const buffer = await fsReadFile(absolutePath)
    return extractPdfText(buffer)
  }

  private isOcrCapableProcessor(id: string): id is FileProcessorId {
    // text_extraction processors known to actually run via OcrService.
    // `mistral` is also registered as a text_extraction processor but
    // routes through an API path that isn't wired here yet.
    return (
      id === BuiltinOcrProviderIds.tesseract ||
      id === BuiltinOcrProviderIds.system ||
      id === BuiltinOcrProviderIds.paddleocr ||
      id === BuiltinOcrProviderIds.ovocr
    )
  }

  private async makeImageFileMetadata(absolutePath: string): Promise<ImageFileMetadata> {
    const stats = await fsStat(absolutePath)
    const name = basename(absolutePath)
    const ext = extname(absolutePath)
    return {
      id: absolutePath,
      name,
      origin_name: name,
      path: absolutePath,
      size: stats.size,
      ext,
      type: FILE_TYPE.IMAGE,
      created_at: new Date(stats.birthtimeMs || stats.mtimeMs).toISOString(),
      count: 1
    }
  }
}

export const fileProcessingService = new FileProcessingService()
