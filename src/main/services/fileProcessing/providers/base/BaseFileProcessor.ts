import path from 'node:path'

import { getTempDir } from '@main/utils/file'
import type { FileProcessorFeature, FileProcessorId } from '@shared/data/preference/preferenceTypes'
import type { FileProcessorFeatureCapability, FileProcessorMerged } from '@shared/data/presets/file-processing'
import type { FileProcessingTextExtractionResult } from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'

import type { IMarkdownConversionProcessor, ITextExtractionProcessor } from '../../interfaces'

const lastUsedKeyByProcessor = new Map<FileProcessorId, string>()

export abstract class BaseFileProcessor {
  protected readonly processorId: FileProcessorId

  constructor(processorId: FileProcessorId) {
    this.processorId = processorId
  }

  protected getRequiredCapability(
    config: FileProcessorMerged,
    feature: FileProcessorFeature
  ): FileProcessorFeatureCapability {
    const capability = config.capabilities.find((item) => item.feature === feature)

    if (!capability) {
      throw new Error(`Processor ${this.processorId} is missing ${feature} capability`)
    }

    return capability
  }

  protected getApiKey(config: FileProcessorMerged): string | undefined {
    const keys = config.apiKeys?.map((value) => value.trim()).filter(Boolean) ?? []

    if (keys.length === 0) {
      return undefined
    }

    if (keys.length === 1) {
      return keys[0]
    }

    const lastUsedKey = lastUsedKeyByProcessor.get(this.processorId)
    const currentIndex = lastUsedKey ? keys.indexOf(lastUsedKey) : -1
    const nextIndex = (currentIndex + 1) % keys.length
    const nextKey = keys[nextIndex]

    lastUsedKeyByProcessor.set(this.processorId, nextKey)
    return nextKey
  }

  protected getFileProcessingResultsDir(providerTaskId: string): string {
    // TODO(file-processing): Results currently live under the temp directory as an
    // interim solution. Once the unified file-management design lands, migrate
    // these artifacts into the canonical file storage tree instead of temp.
    return path.join(getTempDir(), 'file-processing', providerTaskId)
  }
}

export abstract class BaseTextExtractionProcessor extends BaseFileProcessor implements ITextExtractionProcessor {
  abstract extractText(
    file: FileMetadata,
    config: FileProcessorMerged,
    signal?: AbortSignal
  ): Promise<FileProcessingTextExtractionResult>
}

export abstract class BaseMarkdownConversionProcessor
  extends BaseFileProcessor
  implements IMarkdownConversionProcessor
{
  abstract startMarkdownConversionTask(
    ...args: Parameters<IMarkdownConversionProcessor['startMarkdownConversionTask']>
  ): ReturnType<IMarkdownConversionProcessor['startMarkdownConversionTask']>

  abstract getMarkdownConversionTaskResult(
    ...args: Parameters<IMarkdownConversionProcessor['getMarkdownConversionTaskResult']>
  ): ReturnType<IMarkdownConversionProcessor['getMarkdownConversionTaskResult']>
}
