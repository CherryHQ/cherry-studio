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

  protected getRequiredApiKey(config: FileProcessorMerged): string {
    const keys = config.apiKeys?.map((value) => value.trim()).filter(Boolean) ?? []

    if (keys.length === 0) {
      throw new Error(`API key is required for processor ${this.processorId}`)
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

  protected getRequiredApiHost(apiHost?: string): string {
    const host = apiHost?.trim()

    if (!host) {
      throw new Error(`API host is required for processor ${this.processorId}`)
    }

    return host
  }

  protected getRequiredModelId(capability: FileProcessorFeatureCapability, feature: FileProcessorFeature): string {
    if (!capability.modelId) {
      throw new Error(`Processor ${this.processorId} ${feature} modelId is missing`)
    }

    return capability.modelId
  }

  protected getFileProcessingResultsDir(providerTaskId: string): string {
    // TODO: Move file-processing artifacts under the unified file filesystem once processor outputs are managed there.
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

  // TODO: `downloadUrl` is a temporary provider-driven signature. Revisit this abstract contract
  // when implementing providers with richer result payloads than a single downloadable artifact.
  // return markdown file path: path.join(fileProcessingResultsDir, 'output.md')
  protected abstract persistMarkdownConversionResult(providerTaskId: string, downloadUrl: string): Promise<string>
}
